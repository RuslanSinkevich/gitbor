/**
 * AI-модуль: OpenAI-compatible `/v1/chat/completions` и режим Qwen Web
 * (токен сессии https://chat.qwen.ai, как в Skycode).
 */

/**
 * Язык, на котором модель должна писать commit message. Не связан с языком
 * UI. `auto` — не навязывать, модель сама подстраивается под diff.
 */
export type CommitLanguage = 'auto' | 'en' | 'ru';

/** Режим подключения: OpenAI-compatible endpoint или сессия chat.qwen.ai. */
export type AiConnectionMode = 'openai-compatible' | 'qwen-web';

/** Конфигурация подключения к AI-провайдеру. */
export interface AiProviderConfig {
  /**
   * `openai-compatible` — поле baseUrl + apiKey.
   * `qwen-web` — токен из localStorage chat.qwen.ai, см. qwenWebToken.
   */
  mode?: AiConnectionMode;
  /** Базовый URL до `/chat/completions` (обычно заканчивается на `/v1`). */
  baseUrl: string;
  /** API-ключ. Пустая строка — без авторизации (локальные серверы). */
  apiKey: string;
  /** Токен сессии https://chat.qwen.ai (только при mode=qwen-web). */
  qwenWebToken?: string;
  /** Идентификатор модели (например `gpt-4o-mini`, `llama3.1:8b`). */
  model: string;
  /**
   * Язык генерируемого commit message. По умолчанию `auto`. Хранится в
   * конфиге провайдера, а не отдельно, чтобы разные провайдеры/рабочие места
   * могли иметь разные настройки без расщепления store.
   */
  commitLanguage?: CommitLanguage;
  /** Дополнительные HTTP-заголовки (например для корп.прокси). */
  headers?: Record<string, string>;
  /** Таймаут запроса в миллисекундах. По умолчанию 60000. */
  timeoutMs?: number;
}

/** Опции одного вызова AI. */
export interface AiCompletionOptions {
  /** Системный промпт (роль `system`). */
  systemPrompt?: string;
  /** Пользовательский промпт (роль `user`). */
  userPrompt: string;
  /** Максимум токенов в ответе. */
  maxTokens?: number;
  /** Температура, 0..2. */
  temperature?: number;
  /** Сигнал для отмены запроса. */
  signal?: AbortSignal;
  /** Колбек на каждый чанк при streaming. Если не задан — не стримим. */
  onChunk?: (delta: string) => void;
}

/** Результат AI-запроса. */
export interface AiCompletionResult {
  /** Сгенерированный текст целиком. */
  text: string;
  /** Причина остановки: 'stop' | 'length' | 'aborted' | 'error'. */
  finishReason: 'stop' | 'length' | 'aborted' | 'error';
  /** Использованные токены (если провайдер сообщает). */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/** Ошибка AI-запроса со структурированной информацией. */
export class AiError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'http' | 'timeout' | 'aborted' | 'parse' | 'config',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
