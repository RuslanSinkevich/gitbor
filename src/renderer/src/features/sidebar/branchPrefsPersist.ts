/**
 * Per-repo persist для Fork-style фич на ветках:
 *   - pinned: список локальных веток, которые пиннятся наверх в sidebar
 *   - hidden: список веток, чьи коммиты в графе показываются как dimmed
 *   - soloBranch: имя ветки, к которой граф фильтруется (или null)
 *
 * Хранилище — `localStorage`, ключ scope'ится по `repoPath` (как уже сделано
 * для `sg-branch-folders` / `sg-sidebar-sections`). Backend не нужен:
 * pin/hide — чистый UI, solo делает renderer-side фильтр графа.
 *
 * Деградация: при отсутствии localStorage (privacy mode, SSR) — функции
 * молча работают как noop, in-memory состояние всё равно живёт в React-стейте.
 */

import { buildStorageKey, loadStoredJson, saveStoredJson } from '../../shared/uiPersist';

const BASE_PINNED = 'sg-branch-pinned';
const BASE_HIDDEN = 'sg-branch-hidden';
const BASE_SOLO = 'sg-graph-solo';

export interface BranchPrefs {
  pinned: string[];
  hidden: string[];
  /** null — фильтр выключен, граф показывает все ветки (`git log --all`). */
  soloBranch: string | null;
}

const EMPTY: BranchPrefs = { pinned: [], hidden: [], soloBranch: null };

function loadList(baseKey: string, repoPath: string): string[] {
  if (!repoPath) return [];
  const raw = loadStoredJson<unknown>(buildStorageKey(baseKey, repoPath));
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

function saveList(baseKey: string, repoPath: string, list: string[]): void {
  if (!repoPath) return;
  saveStoredJson(buildStorageKey(baseKey, repoPath), list);
}

export function loadBranchPrefs(repoPath: string): BranchPrefs {
  if (!repoPath) return { ...EMPTY };
  const soloRaw = loadStoredJson<unknown>(buildStorageKey(BASE_SOLO, repoPath));
  return {
    pinned: loadList(BASE_PINNED, repoPath),
    hidden: loadList(BASE_HIDDEN, repoPath),
    soloBranch: typeof soloRaw === 'string' && soloRaw.length > 0 ? soloRaw : null,
  };
}

export function savePinned(repoPath: string, pinned: string[]): void {
  saveList(BASE_PINNED, repoPath, pinned);
}

export function saveHidden(repoPath: string, hidden: string[]): void {
  saveList(BASE_HIDDEN, repoPath, hidden);
}

export function saveSoloBranch(repoPath: string, branch: string | null): void {
  if (!repoPath) return;
  saveStoredJson(buildStorageKey(BASE_SOLO, repoPath), branch);
}
