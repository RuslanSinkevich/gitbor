import { OpenAiCompatibleProvider } from './providers/OpenAiCompatibleProvider';
import { buildCommitSystemPrompt, buildCommitUserPrompt } from './prompts';
import { AiError, type AiCompletionResult, type AiProviderConfig } from './types';

export interface CommitMessageOptions {
  diff: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onChunk?: (delta: string) => void;
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
    return !!(c && c.baseUrl && c.model);
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
    const lang = this.config?.commitLanguage ?? 'auto';
    const systemPrompt = options.systemPrompt ?? buildCommitSystemPrompt(lang);
    console.log('[SkyFork AI] generateCommitMessage lang=%s model=%s', lang, this.config?.model);
    const result = await provider.complete({
      systemPrompt,
      userPrompt: buildCommitUserPrompt(options.diff, lang),
      temperature: options.temperature ?? 0.3,
      // По умолчанию не шлём max_tokens — пусть сервер решает сам. Некоторые
      // корп-gateway'и (в т.ч. dtl cloud) интерпретируют фиксированный
      // max_tokens странно и мгновенно отдают finish_reason=length c пустым
      // content. Если очень надо — можно передать maxTokens в опциях.
      maxTokens: options.maxTokens,
      signal: options.signal,
      onChunk: options.onChunk,
    });
    return { ...result, text: postProcessCommit(result.text) };
  }

  private ensureProvider(): OpenAiCompatibleProvider {
    if (!this.config) throw new AiError('AI provider is not configured', 'config');
    return new OpenAiCompatibleProvider(this.config);
  }
}

/**
 * Чистим повторы, лишние кавычки, markdown-кодовые блоки — часто модели
 * оборачивают ответ в ```...``` или в кавычки, хотя просишь «только текст».
 */
function postProcessCommit(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  s = s.replace(/^["'«]+/, '').replace(/["'»]+$/, '');
  return s.trim();
}
