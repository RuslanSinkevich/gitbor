import { readFile } from 'fs/promises';
import { join } from 'path';
import { resolveCommonGitDir } from './gitDir';

const HOOK_MARKERS = [/Conventional Commits/i, /commitlint/i, /\^\(feat\|fix\|docs/i];

/** True when the repo enforces Conventional Commits via commit-msg hook. */
export async function detectConventionalCommits(repoPath: string): Promise<boolean> {
  const paths = [
    join(repoPath, '.husky', 'commit-msg'),
    join(resolveCommonGitDir(repoPath), 'hooks', 'commit-msg'),
  ];
  for (const path of paths) {
    try {
      const content = await readFile(path, 'utf-8');
      if (HOOK_MARKERS.some((re) => re.test(content))) return true;
    } catch {
      // missing hook file
    }
  }
  return false;
}
