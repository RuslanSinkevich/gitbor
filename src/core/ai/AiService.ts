import { buildCommitSystemPrompt, buildCommitUserPrompt, resolvePrompt } from './prompts';
import type { AiProvider } from './providers/base';
import { OpenAiCompatibleProvider } from './providers/OpenAiCompatibleProvider';
import { AiError, type AiCompletionResult, type AiDebugSnapshot, type AiFeatureId, type AiProviderConfig } from './types';
import { mainLogger } from '../utils/Logger';
import { isConventionalCommitSubject } from '../git/commitMessageFormat';

interface RunPromptOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onChunk?: (delta: string) => void;
  debugSink?: (snapshot: AiDebugSnapshot) => void;
  /**
   * Если задан и есть `config.modelOverrides[featureId]` — провайдер
   * получит другую модель вместо `config.model`. Делается через
   * временный provider c подменённым cfg.model, чтобы не плодить
   * сетевые объекты и сохранить per-feature кэширование на уровне HTTP.
   */
  featureId?: AiFeatureId;
}

interface CommitMessageOptions {
  diff: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onChunk?: (delta: string) => void;
  debugSink?: (snapshot: AiDebugSnapshot) => void;
}

/**
 * Фасад AI-функциональности в git-клиенте. Пока единственный use-case —
 * генерация commit message из staged diff'а. Другие кейсы (explain diff,
 * resolve conflict и т.п.) добавим сюда же отдельными методами.
 */
export class AiService {
  constructor(private config: AiProviderConfig | null) {}

  setConfig(config: AiProviderConfig | null): void {
    this.config = config;
  }

  getConfig(): AiProviderConfig | null {
    return this.config;
  }

  /** Возвращает true если конфигурация достаточна для вызова. */
  isConfigured(): boolean {
    const c = this.config;
    if (!c?.model?.trim()) return false;
    const mode = c.mode ?? 'openai-compatible';
    if (mode === 'qwen-web') {
      return false;
    }
    return !!c.baseUrl?.trim();
  }

  async testConnection(signal?: AbortSignal): Promise<void> {
    const provider = this.ensureProvider();
    await provider.testConnection(signal);
  }

  async generateCommitMessage(options: CommitMessageOptions): Promise<AiCompletionResult> {
    const provider = this.ensureProvider();
    if (!options.diff || !options.diff.trim()) {
      throw new AiError('diff is empty — nothing to describe', 'config');
    }
    /* Системный промпт: пользовательский commit-prompt из настроек (если
       задан) + языковая инструкция через resolvePrompt. Если override
       совпадает с дефолтным, ничего не меняется. Старый
       buildCommitSystemPrompt оставлен в кодовой базе для тестов
       (DEFAULT_COMMIT_SYSTEM_PROMPT) и для случая, когда конфиг null. */
    const lang = this.config?.commitLanguage ?? 'auto';
    const promptFromSettings = this.config ? resolvePrompt('commitMessage', this.config) : null;
    const systemPrompt = options.systemPrompt ?? promptFromSettings ?? buildCommitSystemPrompt(lang);
    const userPrompt = buildCommitUserPrompt(options.diff, lang);
    const stripThink = this.config?.stripThinkTags ?? false;
    mainLogger.debug(`AI: generateCommitMessage lang=${lang} model=${this.config?.model ?? 'n/a'}`);

    let result = await provider.complete({
      systemPrompt,
      userPrompt,
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens,
      signal: options.signal,
      onChunk: options.onChunk,
      debugSink: options.debugSink,
    });

    let cleaned = postProcessCommit(result.text, stripThink);
    const canFallback = cleaned.length === 0 && !this.config?.systemInUser;
    if (canFallback) {
      mainLogger.warn('AI: empty response, retrying with systemInUser=true');
      result = await provider.complete({
        systemPrompt,
        userPrompt,
        temperature: options.temperature ?? 0.3,
        maxTokens: options.maxTokens,
        signal: options.signal,
        onChunk: options.onChunk,
        debugSink: options.debugSink ? (s) => options.debugSink!({ ...s, fallbackRetry: 'systemInUser' }) : undefined,
        forceSystemInUser: true,
      });
      cleaned = postProcessCommit(result.text, stripThink);
    }
    if (this.config?.systemInUser && !cleaned.trim()) {
      throw new AiError(
        'Empty response from gateway even with system merged into user. Check gateway debug log.',
        'parse',
      );
    }
    return { ...result, text: cleaned };
  }

  private ensureProvider(): AiProvider {
    if (!this.config) throw new AiError('AI provider is not configured', 'config');
    const mode = this.config.mode ?? 'openai-compatible';
    if (mode === 'qwen-web') {
      throw new AiError('Qwen Web (chat.qwen.ai) is disabled because Aliyun WAF blocks non-browser requests. Use Qwen API or Qwen Corporate instead.', 'config');
    }
    return new OpenAiCompatibleProvider(this.config);
  }

  /**
   * Универсальная точка вызова AI для фич Tier-2. Принимает готовые
   * system/user промпты (renderer/handlers формируют их через
   * `resolvePrompt(id, cfg)` + конкретные плейсхолдеры) и выдаёт
   * текст через `onChunk` (если провайдер streaming) + конечный
   * `AiCompletionResult`.
   *
   * Per-feature model override: если `featureId` задан и в
   * `config.modelOverrides[featureId]` есть непустая строка,
   * создаём временный provider с подменённой моделью.
   */
  async runPrompt(options: RunPromptOptions): Promise<AiCompletionResult> {
    if (!this.config) throw new AiError('AI provider is not configured', 'config');
    const provider = this.providerForFeature(options.featureId);
    const stripThink = this.config.stripThinkTags ?? false;
    const result = await provider.complete({
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens,
      signal: options.signal,
      onChunk: options.onChunk,
      debugSink: options.debugSink,
    });
    if (stripThink) {
      return { ...result, text: stripThinkTags(result.text) };
    }
    return result;
  }

  private providerForFeature(featureId: AiFeatureId | undefined): AiProvider {
    if (!this.config) throw new AiError('AI provider is not configured', 'config');
    const override = featureId ? this.config.modelOverrides?.[featureId]?.trim() : '';
    if (!override) return this.ensureProvider();
    const cfg = { ...this.config, model: override };
    const mode = cfg.mode ?? 'openai-compatible';
    if (mode === 'qwen-web') {
      throw new AiError('Qwen Web (chat.qwen.ai) is disabled because Aliyun WAF blocks non-browser requests. Use Qwen API or Qwen Corporate instead.', 'config');
    }
    return new OpenAiCompatibleProvider(cfg);
  }
}

function stripThinkTags(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '');
}

/**
 * Чистим повторы, лишние кавычки, markdown-кодовые блоки — часто модели
 * оборачивают ответ в ```...``` или в кавычки, хотя просишь «только текст».
 */
function postProcessCommit(raw: string, stripThink = false): string {
  let s = raw;
  if (stripThink) s = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  s = s.trim();
  s = s.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  s = s.replace(/^["'«]+/, '').replace(/["'»]+$/, '');
  s = extractCommitMessageBlock(s);
  return s.trim();
}

function extractCommitMessageBlock(raw: string): string {
  const lines = raw.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isConventionalCommitSubject(lines[i])) start = i;
  }
  if (start === -1) return raw;
  return lines.slice(start).join('\n').trim();
}
