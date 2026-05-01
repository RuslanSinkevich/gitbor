/**
 * Структурированная ошибка с локализационным кодом.
 * Бросается из main, MessageBridge превращает в `error`-событие с `code`/`data`,
 * renderer переводит через `locale.repoErrors[code]` и интерполирует `data`.
 *
 * Зачем: в main нет доступа к языку UI, а хардкод текстов на английском
 * мешает локализации.
 */
export class AppError extends Error {
  constructor(
    /** Локализационный ключ, например `repoErrors.notARepo`. */
    public readonly code: string,
    /** Параметры шаблона (значения подставятся в `{name}` локали). */
    public readonly data: Record<string, string> = {},
    /** Технический фолбэк, если renderer не знает код. */
    fallback?: string,
  ) {
    super(fallback ?? code);
    this.name = 'AppError';
  }
}
