/**
 * Renderer-side logger. Контракт «логи только для dev» (см. core/utils/Logger.ts):
 * в production-сборке Vite (`import.meta.env.DEV === false`) все методы — no-op,
 * в console юзера ничего не сорится. В dev — стандартные `console.*` с префиксом.
 *
 * `error()` намеренно тоже глушится в prod: реальные UI-ошибки идут через
 * ErrorBoundary + IPC `error`-канал в main, где логируются через `mainLogger`
 * в файл (если уровень это позволяет). Дублировать их в renderer-консоль не
 * нужно — от этого только шум в DevTools у пользователей.
 *
 * Если когда-то потребуется временно включить логи в собранном билде —
 * проще всего добавить ручку через `localStorage.setItem('skyfork.log', '1')`
 * и читать её в `isLoggingEnabled()`. Сейчас умышленно не делаю — YAGNI.
 */

const isDev: boolean = !!(import.meta as unknown as { env?: { DEV?: boolean } })?.env?.DEV;

const noop = (): void => {};

interface Logger {
  debug: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const PREFIX = '[SkyFork]';

export const logger: Logger = isDev
  ? {
      debug: (...args) => console.debug(PREFIX, ...args),
      log: (...args) => console.log(PREFIX, ...args),
      info: (...args) => console.info(PREFIX, ...args),
      warn: (...args) => console.warn(PREFIX, ...args),
      error: (...args) => console.error(PREFIX, ...args),
    }
  : {
      debug: noop,
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
    };

/** Проверка для условного кода (например тяжёлых debug-вычислений). */
export function isLoggingEnabled(): boolean {
  return isDev;
}
