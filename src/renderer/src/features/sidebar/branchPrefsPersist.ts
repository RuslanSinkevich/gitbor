/**
 * Per-repo persist для Fork-style фич на ветках:
 *   - pinned: список локальных веток, которые пиннятся наверх в sidebar
 *   - hidden: список веток, чьи коммиты в графе показываются как dimmed
 *   - soloBranch: имя ветки, к которой граф фильтруется (или null)
 *   - notes: произвольная пользовательская заметка по ветке
 *     (Record<branchName, text>; пустые/whitespace значения не сохраняем).
 *
 * Хранилище — `localStorage`, ключ scope'ится по `repoPath` (как уже сделано
 * для `sg-branch-folders` / `sg-sidebar-sections`). Backend не нужен:
 * pin/hide/notes — чистый UI, solo делает renderer-side фильтр графа.
 *
 * Деградация: при отсутствии localStorage (privacy mode, SSR) — функции
 * молча работают как noop, in-memory состояние всё равно живёт в React-стейте.
 */

import { buildStorageKey, loadStoredJson, saveStoredJson } from '../../shared/uiPersist';

const BASE_PINNED = 'sg-branch-pinned';
const BASE_HIDDEN = 'sg-branch-hidden';
const BASE_SOLO = 'sg-graph-solo';
const BASE_NOTES = 'sg-branch-notes';

export interface BranchPrefs {
  pinned: string[];
  hidden: string[];
  /** null — фильтр выключен, граф показывает все ветки (`git log --all`). */
  soloBranch: string | null;
  notes: Record<string, string>;
}

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
  if (!repoPath) return { pinned: [], hidden: [], soloBranch: null, notes: {} };
  const soloRaw = loadStoredJson<unknown>(buildStorageKey(BASE_SOLO, repoPath));
  return {
    pinned: loadList(BASE_PINNED, repoPath),
    hidden: loadList(BASE_HIDDEN, repoPath),
    soloBranch: typeof soloRaw === 'string' && soloRaw.length > 0 ? soloRaw : null,
    notes: loadNotes(repoPath),
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

function loadNotes(repoPath: string): Record<string, string> {
  if (!repoPath) return {};
  const raw = loadStoredJson<unknown>(buildStorageKey(BASE_NOTES, repoPath));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim().length > 0) out[k] = v;
  }
  return out;
}

export function saveBranchNotes(repoPath: string, notes: Record<string, string>): void {
  if (!repoPath) return;
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(notes)) {
    if (typeof v === 'string' && v.trim().length > 0) cleaned[k] = v;
  }
  saveStoredJson(buildStorageKey(BASE_NOTES, repoPath), cleaned);
}

/**
 * Слегка облегчённое API на случай точечной правки одной заметки.
 * Можно было бы делать `saveBranchNotes({ ...prev, [name]: text })`
 * на каждый чих, но 90% мест внутри хука уже сами знают весь объект.
 */
export function saveBranchNote(repoPath: string, branchName: string, text: string): void {
  if (!repoPath || !branchName) return;
  const existing = loadNotes(repoPath);
  const trimmed = text.trim();
  if (trimmed.length === 0) delete existing[branchName];
  else existing[branchName] = text;
  saveBranchNotes(repoPath, existing);
}

function remapList(list: string[], oldName: string, newName: string): string[] {
  if (!list.includes(oldName)) return list;
  const next = list.filter(n => n !== oldName);
  if (!next.includes(newName)) next.push(newName);
  return next;
}

/** Убрать pin/hide/solo/note для одной ветки (удалена или пропала из репо). */
export function dropBranchPrefs(prefs: BranchPrefs, name: string): BranchPrefs {
  if (!name) return prefs;
  const pinned = prefs.pinned.filter(n => n !== name);
  const hidden = prefs.hidden.filter(n => n !== name);
  const soloBranch = prefs.soloBranch === name ? null : prefs.soloBranch;
  if (!(name in prefs.notes) && pinned.length === prefs.pinned.length && hidden.length === prefs.hidden.length && soloBranch === prefs.soloBranch) {
    return prefs;
  }
  const notes = { ...prefs.notes };
  delete notes[name];
  return { pinned, hidden, soloBranch, notes };
}

/**
 * Снять pin/hide/solo для веток, которых больше нет локально.
 *
 * ЗАМЕТКИ (`notes`) НЕ трогаем сознательно. Раньше sync вычищал и заметки
 * для веток вне `localNames` — и это был источник их «пропажи»: при рассинхроне
 * набора (например, localNames ещё от прошлого репо во время переключения,
 * либо частично загруженный список веток) заметки затирались и persist'ились
 * пустыми. Заметки — пользовательский контент; удаляются только явным
 * `dropBranchPrefs` при реальном удалении ветки из UI.
 *
 * pin/hide/solo — производное UI-состояние, их авто-снятие дёшево и обратимо,
 * поэтому оставляем. Возврат того же объекта при отсутствии изменений важен:
 * хук в `useBranchPrefs` полагается на `next === prev`, чтобы не перезаписывать
 * хранилище на каждый рендер.
 */
export function syncBranchPrefs(prefs: BranchPrefs, localNames: ReadonlySet<string>): BranchPrefs {
  if (localNames.size === 0) return prefs;
  const pinned = prefs.pinned.filter(n => localNames.has(n));
  const hidden = prefs.hidden.filter(n => localNames.has(n));
  const soloBranch = prefs.soloBranch && !localNames.has(prefs.soloBranch) ? null : prefs.soloBranch;
  if (
    pinned.length === prefs.pinned.length &&
    hidden.length === prefs.hidden.length &&
    soloBranch === prefs.soloBranch
  ) {
    return prefs;
  }
  return { pinned, hidden, soloBranch, notes: prefs.notes };
}

/** Перенести pin/hide/solo/notes при `git branch -m`. */
export function migrateBranchPrefs(
  prefs: BranchPrefs,
  oldName: string,
  newName: string,
): BranchPrefs {
  if (!oldName || !newName || oldName === newName) return prefs;

  const pinned = remapList(prefs.pinned, oldName, newName);
  const hidden = remapList(prefs.hidden, oldName, newName);
  const soloBranch = prefs.soloBranch === oldName ? newName : prefs.soloBranch;
  let notes = prefs.notes;
  if (oldName in prefs.notes) {
    notes = { ...prefs.notes, [newName]: prefs.notes[oldName] };
    delete notes[oldName];
  }

  if (pinned === prefs.pinned && hidden === prefs.hidden && soloBranch === prefs.soloBranch && notes === prefs.notes) {
    return prefs;
  }
  return { pinned, hidden, soloBranch, notes };
}

export function saveBranchPrefs(repoPath: string, prefs: BranchPrefs): void {
  savePinned(repoPath, prefs.pinned);
  saveHidden(repoPath, prefs.hidden);
  saveSoloBranch(repoPath, prefs.soloBranch);
  saveBranchNotes(repoPath, prefs.notes);
}
