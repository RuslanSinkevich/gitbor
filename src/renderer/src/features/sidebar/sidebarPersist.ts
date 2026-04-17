/** Состояние сайдбара (секции + дерево веток): renderer, localStorage, ключи с привязкой к пути репозитория. */

const SECTIONS_KEY = 'sg-sidebar-sections';

export interface SidebarSectionsPersist {
  branches: boolean;
  remotes: boolean;
  tags: boolean;
  stashes: boolean;
}

export function loadSidebarSections(): Partial<SidebarSectionsPersist> | null {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<SidebarSectionsPersist>;
  } catch {
    return null;
  }
}

export function saveSidebarSections(s: SidebarSectionsPersist): void {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** scope: '' — локальные ветки; иначе имя remote (ветки origin/… и т.д.). */
function branchExpandKey(repoPath: string, scope: string): string {
  const id = encodeURIComponent(repoPath.replace(/\\/g, '/'));
  const sc = scope ? `:${encodeURIComponent(scope)}` : '';
  return `sg-branch-folders:${id}${sc}`;
}

/** null — ещё не сохраняли для этого репо; иначе полный список развёрнутых fullPath папок. */
export function loadBranchFolderExpanded(repoPath: string, scope = ''): string[] | null {
  if (!repoPath) return null;
  try {
    const raw = localStorage.getItem(branchExpandKey(repoPath, scope));
    if (raw === null) return null;
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export function saveBranchFolderExpanded(repoPath: string, fullPaths: Set<string>, scope = ''): void {
  if (!repoPath) return;
  try {
    localStorage.setItem(branchExpandKey(repoPath, scope), JSON.stringify([...fullPaths]));
  } catch {
    /* ignore */
  }
}
