/**
 * Pure helpers for the "remote-only commits" feature.
 *
 * A commit is *remote-only* when it is reachable from `refs/remotes/*` but
 * not from any `refs/heads/*` (i.e. fetch brought it in, but no local branch
 * yet integrated it via pull/merge/rebase).
 *
 * Detection is delegated to `git rev-list refs/remotes --not refs/heads`,
 * which prints one hash per line. The pure parser below is split off so
 * tests can verify its quirks (trailing newlines, CRLF, empty stdout)
 * without spawning git.
 */

/**
 * Convert stdout of `git rev-list refs/remotes --not refs/heads` into a
 * Set of commit hashes. Empty/whitespace-only lines are ignored;
 * CR is stripped from line endings.
 */
export function parseRemoteOnlyHashes(stdout: string): Set<string> {
  const result = new Set<string>();
  if (!stdout) return result;
  for (const raw of stdout.split('\n')) {
    const trimmed = raw.replace(/\r$/, '').trim();
    if (trimmed.length > 0) result.add(trimmed);
  }
  return result;
}
