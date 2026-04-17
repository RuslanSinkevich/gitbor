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
  try {
    const p = localStorage.getItem(LAST_ACTIVE_REPO_KEY);
    return p && p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

export function saveLastActiveRepo(path: string): void {
  try {
    localStorage.setItem(LAST_ACTIVE_REPO_KEY, path);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearLastActiveRepo(): void {
  try {
    localStorage.removeItem(LAST_ACTIVE_REPO_KEY);
  } catch {
    /* ignore */
  }
}

export function sameRepoPath(a: string, b: string): boolean {
  return normRepoPath(a) === normRepoPath(b);
}

export function loadRecent(): RecentRepo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentRepo[];
  } catch {
    return [];
  }
}

export function saveRecent(repos: RecentRepo[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(repos.slice(0, MAX_RECENT)));
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
