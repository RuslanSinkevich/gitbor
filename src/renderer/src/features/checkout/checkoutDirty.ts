import type { FileStatus } from '../../types';

/** Уникальные пути с реальными локальными изменениями (stat-dirty не считаем). */
export function countCheckoutDirty(staged: FileStatus[], unstaged: FileStatus[]): number {
  const paths = new Set<string>();
  for (const f of staged) paths.add(f.path);
  for (const f of unstaged) {
    if (f.statDirty) continue;
    paths.add(f.path);
  }
  return paths.size;
}
