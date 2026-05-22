import { existsSync, statSync, unlinkSync } from 'fs';
import { mainLogger } from '../utils/Logger';

/**
 * Ожидание освобождения `.git/index.lock` с exponential backoff.
 *
 * Идея — копировать поведение Fork: НЕ открывать сразу диалог при свежем
 * lock'е, а подождать пару секунд (типичная длительность операции).
 * Если за это окно lock исчез — продолжаем молча. Если нет — отдаём
 * управление обратно вызывающему: пусть он решит (PreflightChecks
 * выдаст issue 'lock_held_fresh' → SafetyDialog).
 *
 * Дополнительно: hard timeout (по умолчанию 5с) — после которого
 * waiter гарантированно вернёт результат, даже если был зависший git
 * процесс или замороженный диск.
 */
export interface LockWaiterOptions {
  /**
   * Расписание задержек между попытками (мс). По умолчанию
   * [100, 200, 400, 800, 1600] → суммарно ≈ 3.1с покрывает 90%+
   * легальных git-операций. Тесты должны передавать [] или [1]
   * для мгновенного выхода.
   */
  delays?: number[];
  /** Жёсткий потолок ожидания (мс). По умолчанию 5_000. */
  hardTimeoutMs?: number;
  /** Возраст, при котором lock считаем "однозначно мёртвым". По умолчанию 15_000. */
  staleAgeMs?: number;
}

export interface LockWaiterResult {
  /** Lock исчез за окно ожидания (legitimate process finished). */
  released: boolean;
  /** Возраст lock'а в момент финальной проверки (если ещё есть). */
  finalAgeMs?: number;
  /** Сколько прождали по факту (мс). */
  waitedMs: number;
  /**
   * Lock не двинулся за окно ожидания (mtime не менялась). Если он
   * при этом старше `staleAgeMs` — можно безопасно удалить.
   */
  staleSuspect: boolean;
}

const DEFAULT_DELAYS = [100, 200, 400, 800, 1600];
const DEFAULT_HARD_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_AGE_MS = 15_000;

export async function waitForLockRelease(
  lockPath: string,
  opts: LockWaiterOptions = {},
): Promise<LockWaiterResult> {
  const delays = opts.delays ?? DEFAULT_DELAYS;
  const hardTimeoutMs = opts.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;
  const staleAgeMs = opts.staleAgeMs ?? DEFAULT_STALE_AGE_MS;

  const t0 = Date.now();
  const firstMtime = safeMtime(lockPath);
  if (firstMtime === null) {
    return { released: true, waitedMs: 0, staleSuspect: false };
  }

  let lastMtime = firstMtime;

  for (const delay of delays) {
    if (Date.now() - t0 >= hardTimeoutMs) break;
    await sleep(delay);

    if (!existsSync(lockPath)) {
      return { released: true, waitedMs: Date.now() - t0, staleSuspect: false };
    }
    const currentMtime = safeMtime(lockPath);
    if (currentMtime === null) {
      return { released: true, waitedMs: Date.now() - t0, staleSuspect: false };
    }
    lastMtime = currentMtime;
  }

  const finalAgeMs = Date.now() - lastMtime;
  const mtimeMoved = lastMtime !== firstMtime;
  const staleSuspect = !mtimeMoved && finalAgeMs >= staleAgeMs;

  return {
    released: false,
    finalAgeMs,
    waitedMs: Date.now() - t0,
    staleSuspect,
  };
}

/**
 * Удалить stale lock, если waiter решил что он мёртв. Возвращает
 * `true` если удалили, `false` если не получилось.
 */
export function tryRemoveStaleLock(lockPath: string): boolean {
  try {
    unlinkSync(lockPath);
    mainLogger.info(`lockWaiter: removed stale ${lockPath}`);
    return true;
  } catch (err) {
    mainLogger.warn(`lockWaiter: failed to remove stale lock: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function safeMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}
