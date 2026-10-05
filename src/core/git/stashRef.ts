/**
 * `git stash drop` принимает только `stash@{n}`, не commit-hash.
 * `apply`/`show` работают с hash — поэтому в drop часто приходит hash
 * (SafetyNet auto-stash, recovery dialog). Резолвим hash → `stash@{n}`.
 */

const STASH_REF_RE = /^stash@\{\d+\}$/;

export interface StashListExec {
  exec(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/**
 * Вернуть ref, пригодный для `git stash drop`.
 * Уже `stash@{n}` — as-is. Hash — ищем в `stash list`.
 * `null` если записи нет.
 */
export async function resolveStashDropRef(
  git: StashListExec,
  stashOrHash: string,
): Promise<string | null> {
  const trimmed = stashOrHash.trim();
  if (!trimmed) return null;
  if (STASH_REF_RE.test(trimmed)) return trimmed;

  const list = await git.exec(['stash', 'list', '--format=%gd%x00%H']);
  if (list.exitCode !== 0 || !list.stdout.trim()) return null;

  for (const line of list.stdout.trim().split('\n')) {
    const [ref, hash] = line.split('\x00');
    if (!ref || !hash) continue;
    if (hash === trimmed || hash.startsWith(trimmed) || trimmed.startsWith(hash)) {
      return ref;
    }
  }
  return null;
}

/**
 * Текущая вершина `refs/stash` ('' — стэшей нет). `git stash push` при
 * «нечего откладывать» выходит с кодом 0, поэтому факт создания стэша
 * проверяем сдвигом этого ref'а, а не exit-кодом/stdout (он локализован).
 */
export async function readStashTip(git: StashListExec): Promise<string> {
  const r = await git.exec(['rev-parse', '-q', '--verify', 'refs/stash']);
  return r.exitCode === 0 ? r.stdout.trim() : '';
}
