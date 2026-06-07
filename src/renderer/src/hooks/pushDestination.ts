/**
 * Когда можно вызывать plain `git push` (push.default=simple):
 * локальная ветка и upstream должны совпадать по короткому имени.
 */

/** Имя ветки после `<remote>/` в %(upstream:short). */
export function upstreamBranchShort(
  upstream: string | undefined,
  remote?: string,
): string | null {
  if (!upstream?.trim()) return null;
  const u = upstream.trim();
  if (remote !== undefined) {
    const prefix = `${remote}/`;
    return u.startsWith(prefix) ? u.slice(prefix.length) : null;
  }
  const slash = u.indexOf('/');
  if (slash <= 0) return u;
  return u.slice(slash + 1);
}

export function canPushDirectly(currentBranch: string, upstream: string | undefined): boolean {
  const local = currentBranch.trim();
  const u = upstream?.trim();
  if (!local || !u) return false;
  if (u === local) return true;
  return u.endsWith(`/${local}`);
}

/**
 * Распознать stderr `git push` про РАСХОЖДЕНИЕ имени локальной ветки и
 * upstream при `push.default=simple` — единственный кейс, на который имеет
 * смысл повторно открывать диалог Push (выбрать целевую ветку явно).
 *
 * Каноничный текст git (builtin/push.c):
 *   "The upstream branch of your current branch does not match
 *    the name of your current branch."
 *
 * Намеренно НЕ матчим non-fast-forward ("failed to push some refs",
 * "Updates were rejected") — там нужен force/pull, а не выбор ветки,
 * и автодиалог только сбивал бы с толку.
 */
export function isPushDefaultMismatch(stderr: string | undefined | null): boolean {
  if (!stderr) return false;
  const norm = stderr.replace(/\s+/g, ' ').toLowerCase();
  return norm.includes(
    'upstream branch of your current branch does not match the name of your current branch',
  );
}
