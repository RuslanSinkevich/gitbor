import { buildCommitSystemPrompt, buildCommitUserPrompt } from './prompts';
import type { AiProvider } from './providers/base';
import { OpenAiCompatibleProvider } from './providers/OpenAiCompatibleProvider';
import { QwenWebProvider } from './providers/QwenWebProvider';
import { AiError, type AiCompletionResult, type AiProviderConfig } from './types';
import { mainLogger } from '../utils/Logger';

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
    if (!c?.model?.trim()) return false;
    const mode = c.mode ?? 'openai-compatible';
    if (mode === 'qwen-web') {
      return !!(c.qwenWebToken || '').trim();
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
    const lang = this.config?.commitLanguage ?? 'auto';
    const systemPrompt = options.systemPrompt ?? buildCommitSystemPrompt(lang);
    mainLogger.debug(`AI: generateCommitMessage lang=${lang} model=${this.config?.model ?? 'n/a'}`);
    const result = await provider.complete({
      systemPrompt,
      userPrompt: buildCommitUserPrompt(options.diff, lang),
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens,
      signal: options.signal,
      onChunk: options.onChunk,
    });
    return { ...result, text: postProcessCommit(result.text) };
  }

  private ensureProvider(): AiProvider {
    if (!this.config) throw new AiError('AI provider is not configured', 'config');
    const mode = this.config.mode ?? 'openai-compatible';
    if (mode === 'qwen-web') {
      return new QwenWebProvider(this.config);
    }
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
