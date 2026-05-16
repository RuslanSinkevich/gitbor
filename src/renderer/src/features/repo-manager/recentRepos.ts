import { loadStoredJson, loadStoredString, removeStoredValue, saveStoredJson, saveStoredString } from '../../shared/uiPersist';

export interface RecentRepo {
  name: string;
  path: string;
  lastOpened: number;
}

const STORAGE_KEY = 'sg-recent-repos';
const LAST_ACTIVE_REPO_KEY = 'sg-last-active-repo';
const OPEN_REPOS_KEY = 'sg-open-repos';
const MAX_RECENT = 20;
const MAX_OPEN_REPOS = 50;

function normRepoPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/** Последний открытый репозиторий (для восстановления при следующем запуске). Renderer: localStorage. */
export function loadLastActiveRepo(): string | null {
  const p = loadStoredString(LAST_ACTIVE_REPO_KEY);
  return p && p.length > 0 ? p : null;
}

export function saveLastActiveRepo(path: string): void {
  saveStoredString(LAST_ACTIVE_REPO_KEY, path);
}

export function clearLastActiveRepo(): void {
  removeStoredValue(LAST_ACTIVE_REPO_KEY);
}

export function sameRepoPath(a: string, b: string): boolean {
  return normRepoPath(a) === normRepoPath(b);
}

/**
 * Найти индекс репо в `openRepos` по сохранённому пути (нормализованное
 * сравнение слэшей/регистра). Используется при старте: восстановление
 * активного таба по пути, а не по индексу — индексы нестабильны при
 * изменении порядка/закрытии вкладок между сессиями.
 */
export function findRepoIndexByPath<T extends { path: string }>(repos: readonly T[], path: string): number {
  if (!path) return -1;
  for (let i = 0; i < repos.length; i++) {
    if (sameRepoPath(repos[i].path, path)) return i;
  }
  return -1;
}

export function loadRecent(): RecentRepo[] {
  return loadStoredJson<RecentRepo[]>(STORAGE_KEY) ?? [];
}

function saveRecent(repos: RecentRepo[]): void {
  saveStoredJson(STORAGE_KEY, repos.slice(0, MAX_RECENT));
}

export function addRecentRepo(name: string, path: string): void {
  const repos = loadRecent().filter(r => r.path !== path);
  repos.unshift({ name, path, lastOpened: Date.now() });
  saveRecent(repos);
}

export function removeRecentRepo(path: string): RecentRepo[] {
  const repos = loadRecent().filter(r => r.path !== path);
  saveRecent(repos);
  return repos;
}

/**
 * Сохранённый список ОТКРЫТЫХ табов репо (восстанавливается при старте).
 * Отдельно от recents — recents это история, а open это активная сессия.
 * Храним только пути; имена резолвятся через basename при открытии.
 */
export function loadOpenRepos(): string[] {
  const raw = loadStoredJson<unknown>(OPEN_REPOS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

export function saveOpenRepos(paths: readonly string[]): void {
  // Дедуп по нормализованному пути — на случай если main отдаёт дубли.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of paths) {
    const key = normRepoPath(p);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  saveStoredJson(OPEN_REPOS_KEY, unique.slice(0, MAX_OPEN_REPOS));
}

export function clearOpenRepos(): void {
  removeStoredValue(OPEN_REPOS_KEY);
}
