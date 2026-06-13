import { describe, expect, it } from 'vitest';
import {
  applyConventionalType,
  ensureConventionalSubject,
  isConventionalCommitSubject,
  parseConventionalType,
} from '../../src/core/git/commitMessageFormat';

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

describe('parseConventionalType', () => {
  it('extracts the type from a header', () => {
    expect(parseConventionalType('feat(scope): add x')).toBe('feat');
    expect(parseConventionalType('fix!: urgent')).toBe('fix');
    expect(parseConventionalType('CHORE: bump')).toBe('chore');
  });

  it('returns null without a valid type', () => {
    expect(parseConventionalType('hello world')).toBeNull();
    expect(parseConventionalType('wip: something')).toBeNull();
  });
});

describe('applyConventionalType', () => {
  it('prepends a type when none present', () => {
    expect(applyConventionalType('add feature', 'feat')).toBe('feat: add feature');
  });

  it('replaces the type but keeps scope, bang and description', () => {
    expect(applyConventionalType('fix(api)!: boom', 'feat')).toBe('feat(api)!: boom');
    expect(applyConventionalType('docs: guide', 'chore')).toBe('chore: guide');
  });
});

describe('ensureConventionalSubject', () => {
  it('keeps already-valid subjects', () => {
    expect(ensureConventionalSubject('fix: bug', 'feat')).toBe('fix: bug');
  });

  it('prepends the default type when missing', () => {
    expect(ensureConventionalSubject('just text', 'feat')).toBe('feat: just text');
  });

  it('leaves empty input untouched', () => {
    expect(ensureConventionalSubject('   ', 'feat')).toBe('');
  });
});
