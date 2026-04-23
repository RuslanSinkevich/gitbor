/** Состояние сайдбара (секции + дерево веток): renderer, localStorage, ключи с привязкой к пути репозитория. */

import { buildStorageKey, loadStoredJson, saveStoredJson } from '../../shared/uiPersist';

const SECTIONS_KEY = 'sg-sidebar-sections';

export interface SidebarSectionsPersist {
  branches: boolean;
  remotes: boolean;
  tags: boolean;
  stashes: boolean;
}

export function loadSidebarSections(): Partial<SidebarSectionsPersist> | null {
  return loadStoredJson<Partial<SidebarSectionsPersist>>(SECTIONS_KEY);
}

export function saveSidebarSections(s: SidebarSectionsPersist): void {
  saveStoredJson(SECTIONS_KEY, s);
}

/** scope: '' — локальные ветки; иначе имя remote (ветки origin/… и т.д.). */
function branchExpandKey(repoPath: string, scope: string): string {
  const repoScoped = buildStorageKey('sg-branch-folders', repoPath);
  return scope ? buildStorageKey(repoScoped, scope) : repoScoped;
}

/** null — ещё не сохраняли для этого репо; иначе полный список развёрнутых fullPath папок. */
export function loadBranchFolderExpanded(repoPath: string, scope = ''): string[] | null {
  if (!repoPath) return null;
  const arr = loadStoredJson<unknown>(branchExpandKey(repoPath, scope));
  if (arr === null) return null;
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : null;
}

export function saveBranchFolderExpanded(repoPath: string, fullPaths: Set<string>, scope = ''): void {
  if (!repoPath) return;
  saveStoredJson(branchExpandKey(repoPath, scope), [...fullPaths]);
}
