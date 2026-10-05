import { readFileSync, statSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

/**
 * Реальный git-dir рабочей копии.
 *
 * В обычном репо это `<repo>/.git`, но в связанном worktree и в подмодуле
 * `.git` — ФАЙЛ вида `gitdir: <path>`. `join(repo, '.git')` там указывает
 * на файл, и проверки MERGE_HEAD / rebase-merge / index.lock / журнала
 * молча ничего не находят. Резолвим синхронно (дёшево, файл крошечный).
 */
const gitDirCache = new Map<string, string>();

export function resolveGitDir(repoPath: string): string {
  const cached = gitDirCache.get(repoPath);
  if (cached) return cached;
  const dotGit = join(repoPath, '.git');
  try {
    let dir = dotGit;
    if (statSync(dotGit).isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
      if (m) dir = isAbsolute(m[1]) ? m[1] : resolve(repoPath, m[1]);
    }
    gitDirCache.set(repoPath, dir);
    return dir;
  } catch {
    // `.git` ещё нет (init/clone в процессе) — не кэшируем.
    return dotGit;
  }
}

/**
 * Общий git-dir (refs, hooks, config). Для worktree — содержимое файла
 * `commondir`; для обычного репо совпадает с `resolveGitDir`.
 */
export function resolveCommonGitDir(repoPath: string): string {
  const gitDir = resolveGitDir(repoPath);
  try {
    const common = readFileSync(join(gitDir, 'commondir'), 'utf8').trim();
    if (common) return isAbsolute(common) ? common : resolve(gitDir, common);
  } catch {
    // нет commondir — это и есть общий git-dir
  }
  return gitDir;
}
