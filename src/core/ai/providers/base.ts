import type { AiCompletionOptions, AiCompletionResult } from '../types';

/**
 * Интерфейс AI-провайдера. Одноразовый complete: «дай промпт — получи ответ».
 * Для multi-turn чата в git-клиенте необходимости нет.
 */
export interface AiProvider {
  /** Выполнить завершение промпта. */
  complete(options: AiCompletionOptions): Promise<AiCompletionResult>;
  /** Лёгкая проверка: доступен ли endpoint. Используется для `Test connection`. */
  testConnection(signal?: AbortSignal): Promise<void>;
}
