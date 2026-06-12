const CONVENTIONAL_HEADER_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9_./-]+\))?!?: .+/;

/** First line passes a conventional-commits commit-msg hook. */
export function isConventionalCommitSubject(subject: string): boolean {
  const line = subject.trim();
  if (!line) return false;
  if (/^Merge/i.test(line) || /^Revert/i.test(line)) return true;
  return CONVENTIONAL_HEADER_RE.test(line);
}
