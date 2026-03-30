export interface RecentRepo {
  name: string;
  path: string;
  lastOpened: number;
}

const STORAGE_KEY = 'sg-recent-repos';
const MAX_RECENT = 20;

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
