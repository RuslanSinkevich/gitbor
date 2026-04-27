/**
 * AI-модуль: универсальные типы для работы с OpenAI-compatible endpoint'ами.
 *
 * Поддерживает любой сервис, который реализует /v1/chat/completions в формате
 * OpenAI: сам OpenAI, Ollama, LM Studio, vLLM, LiteLLM, Groq, корпоративные
 * gateway'и, локальные runner'ы и т.п. Специфические провайдеры (GigaChat,
 * YandexGPT) пока не поддерживаются.
 */

/**
 * Язык, на котором модель должна писать commit message. Не связан с языком
 * UI. `auto` — не навязывать, модель сама подстраивается под diff.
 */
export type CommitLanguage = 'auto' | 'en' | 'ru';

/** Конфигурация подключения к AI-провайдеру. */
export interface AiProviderConfig {
  /** Базовый URL до `/chat/completions` (обычно заканчивается на `/v1`). */
  baseUrl: string;
  /** API-ключ. Пустая строка — без авторизации (локальные серверы). */
  apiKey: string;
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
