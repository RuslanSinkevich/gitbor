import { describe, expect, it } from 'vitest';
import { isConventionalCommitSubject } from '../../src/core/git/commitMessageFormat';

describe('isConventionalCommitSubject', () => {
  it('accepts valid headers', () => {
    expect(isConventionalCommitSubject('fix(vue): исправить фильтр')).toBe(true);
    expect(isConventionalCommitSubject('feat(react): add Slider')).toBe(true);
    expect(isConventionalCommitSubject('docs: update guide')).toBe(true);
  });

  it('rejects plain text', () => {
    expect(isConventionalCommitSubject('исправил')).toBe(false);
    expect(isConventionalCommitSubject('fix:')).toBe(false);
  });

  it('allows merge and revert', () => {
    expect(isConventionalCommitSubject("Merge branch 'main' into dev")).toBe(true);
    expect(isConventionalCommitSubject('Revert "fix(core): bug"')).toBe(true);
  });
});
