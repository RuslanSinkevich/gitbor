import { mkdirSync, createWriteStream, type WriteStream } from 'fs';
import { join } from 'path';
import { app } from 'electron';

/**
 * Уровни логирования (по убыванию важности):
 * - 'silent' — ничего не пишем (prod по умолчанию: чистый stdout/файл).
 * - 'error'  — только ошибки.
 * - 'warn'   — предупреждения и ошибки.
 * - 'info'   — инфо + warn + error.
 * - 'debug'  — всё (dev по умолчанию).
 */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/**
 * Logger main-процесса. Пишет в console и опционально в файл.
 *
 * Контракт «логи только в dev» (запрос пользователя): в production
 * по умолчанию `level = 'silent'` → ни в консоль, ни в файл. В dev
 * `level = 'debug'` → всё видно. Configure'ит уровень `configureLogger()`
 * (вызывается из `main.ts` после `app.whenReady`).
 *
 * `error()`/`warn()` всё равно полезны как отдельные методы: если кто-то
 * захочет в проде поднять уровень до 'warn' (через ENV или флаг) — оно
 * заработает без изменения вызывающего кода.
 */
export class Logger {
  private logStream: WriteStream | null = null;
  private consoleAvailable = true;
  private level: LogLevel = 'debug';
  private fileEnabled = false;

  constructor(private readonly prefix: string) {}

  /** Открывает файл-лог (только если уровень не silent и file логирование включено). */
  init(): void {
    if (!this.fileEnabled) return;
    if (this.level === 'silent') return;
    if (this.logStream) return;
    try {
      const logsDir = join(app.getPath('userData'), 'logs');
      mkdirSync(logsDir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const logPath = join(logsDir, `${date}.log`);
      this.logStream = createWriteStream(logPath, { flags: 'a' });
      this.logStream.on('error', () => {
        this.logStream = null;
      });
    } catch {
      this.logStream = null;
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
    if (level === 'silent') {
      // В silent режиме закрываем файл, чтобы не держать дескриптор зря.
      this.dispose();
    }
  }

  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Включить запись в файл `<userData>/logs/YYYY-MM-DD.log`. По умолчанию
   * выключено: в prod-режиме (silent) логи никуда не идут — это и есть
   * запрошенное «логи только для dev». Вызывайте до `init()`.
   */
  enableFile(enabled = true): void {
    this.fileEnabled = enabled;
  }

  debug(message: string): void {
    this.write('DEBUG', message);
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  /** Backward-compat: `log()` = INFO. */
  log(message: string): void {
    this.info(message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  error(message: string): void {
    this.write('ERROR', message);
  }

  dispose(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  private shouldLog(target: Exclude<LogLevel, 'silent'>): boolean {
    return LEVEL_ORDER[this.level] >= LEVEL_ORDER[target];
  }

  private write(tag: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const target = tag.toLowerCase() as Exclude<LogLevel, 'silent'>;
    if (!this.shouldLog(target)) return;

    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const line = `[${this.prefix}] ${time} ${tag}: ${message}`;

    if (this.consoleAvailable) {
      try {
        // ERROR/WARN — в stderr, остальное — в stdout. Это позволит CI
        // и npm-скриптам корректно различать поток.
        if (tag === 'ERROR' || tag === 'WARN') console.error(line);
        else console.log(line);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
          this.consoleAvailable = false;
        } else {
          throw error;
        }
      }
    }

    if (this.logStream) {
      this.logStream.write(line + '\n');
    }
  }
}

/**
 * Singleton main-процесса. Используется всеми модулями, чтобы не плодить
 * инстансы (раньше каждый модуль писал в `console.*` напрямую → невозможно
 * было выключить).
 */
export const mainLogger = new Logger('SkyFork');

/**
 * Конфигурация logger'а из `main.ts`. Должно вызываться один раз
 * после `app.whenReady` (нужен `app.getPath('userData')` для file-лога).
 *
 * Контракт «только dev»: если `app.isPackaged` — `level = 'silent'`,
 * и file-лог не пишется (тоже отключаем). В dev — `level = 'debug'`
 * с файлом.
 *
 * `SKYFORK_LOG_LEVEL` env (опционально) перебивает дефолт — удобно для
 * включения логов в собранном билде при дебаге у пользователя.
 */
export function configureMainLogger(opts: { isProduction: boolean }): void {
  const envLevel = parseLevel(process.env.SKYFORK_LOG_LEVEL);
  const level: LogLevel = envLevel ?? (opts.isProduction ? 'silent' : 'debug');
  mainLogger.setLevel(level);
  if (level !== 'silent') {
    mainLogger.enableFile(true);
    mainLogger.init();
  }
}

function parseLevel(raw: string | undefined): LogLevel | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === 'silent' || v === 'error' || v === 'warn' || v === 'info' || v === 'debug') return v;
  return null;
}
