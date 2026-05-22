import type { Stash } from '../../types';

/** Префикс auto-stash сообщений (синхронизировано с core/safety/SafetyNet). */
export const AUTO_STASH_PREFIX = '[GitBor auto-stash]';

export function isAutoStash(stash: Stash): boolean {
  return (stash.message || '').includes(AUTO_STASH_PREFIX);
}
