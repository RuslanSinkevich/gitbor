import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { GitErrorClass } from '../git/types';
import { mainLogger } from '../utils/Logger';

/**
 * Опциональный telemetry-счётчик ошибок по `GitErrorClass`.
 *
 * Выключен по умолчанию: пишется только если есть env-переменная
 * `GITBOR_SAFETY_STATS=1` ИЛИ файл уже существует (значит юзер один раз
 * его создал и хочет накопления). Никаких сетевых отправок — всё локально
 * в `userData/safety-stats.json`.
 *
 * Зачем: после feature-релиза хотим иметь возможность спросить
 * пользователя "какие классы ошибок чаще всего видишь?" без полной
 * телеметрии и трекинга.
 */

type Stats = Record<string, number>;

interface SafetyStatsFile {
  version: 1;
  startedAt: number;
  counts: Stats;
}

let statsPath: string | null = null;
let cached: SafetyStatsFile | null = null;
let enabled = false;

/**
 * Инициализация. Вызывается из main bootstrap. Если `userDataPath` пустой
 * (тесты) или telemetry не включена — все методы превращаются в no-op.
 */
export function initSafetyStats(userDataPath: string | null, opts?: { force?: boolean }): void {
  if (!userDataPath) return;
  statsPath = join(userDataPath, 'safety-stats.json');

  const fileExists = existsSync(statsPath);
  const envOn = process.env.GITBOR_SAFETY_STATS === '1';
  enabled = !!opts?.force || envOn || fileExists;

  if (!enabled) return;

  try {
    if (fileExists) {
      cached = JSON.parse(readFileSync(statsPath, 'utf-8')) as SafetyStatsFile;
      if (cached.version !== 1 || !cached.counts) throw new Error('bad version');
    } else {
      cached = { version: 1, startedAt: Date.now(), counts: {} };
      flush();
    }
  } catch (err) {
    mainLogger.warn(`safetyStats: failed to load/init, telemetry off: ${err instanceof Error ? err.message : String(err)}`);
    enabled = false;
    cached = null;
  }
}

export function recordErrorClass(cls: GitErrorClass): void {
  if (!enabled || !cached) return;
  cached.counts[cls] = (cached.counts[cls] ?? 0) + 1;
  flush();
}

export function getSafetyStats(): SafetyStatsFile | null {
  return enabled ? cached : null;
}

function flush(): void {
  if (!statsPath || !cached) return;
  try {
    mkdirSync(dirname(statsPath), { recursive: true });
    writeFileSync(statsPath, JSON.stringify(cached, null, 2));
  } catch (err) {
    mainLogger.debug(`safetyStats: flush failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
