import { loadStoredJson, loadStoredString, removeStoredValue, saveStoredJson, saveStoredString } from '../../shared/uiPersist';

export interface RecentRepo {
  name: string;
  path: string;
  lastOpened: number;
}

const STORAGE_KEY = 'sg-recent-repos';
const LAST_ACTIVE_REPO_KEY = 'sg-last-active-repo';
const MAX_RECENT = 20;

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

export function saveRecent(repos: RecentRepo[]): void {
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
