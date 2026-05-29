import { describe, it, expect } from 'vitest';
import { migrateBranchPrefs } from '../../src/renderer/src/features/sidebar/branchPrefsPersist';

describe('migrateBranchPrefs', () => {
  const base = {
    pinned: ['feature/a'],
    hidden: ['feature/b'],
    soloBranch: 'feature/c',
    notes: { 'feature/old': 'ticket description' },
  };

  it('migrates pin, hide, solo and note to new branch name', () => {
    const prefs = {
      pinned: ['feature/SinkevichRN/NRGIND-34782'],
      hidden: ['feature/SinkevichRN/NRGIND-34782'],
      soloBranch: 'feature/SinkevichRN/NRGIND-34782',
      notes: { 'feature/SinkevichRN/NRGIND-34782': 'NRGIND-31848: problem' },
    };
    const next = migrateBranchPrefs(
      prefs,
      'feature/SinkevichRN/NRGIND-34782',
      'feature/SinkevichRN/Completed/NRGIND-34782',
    );
    expect(next.pinned).toEqual(['feature/SinkevichRN/Completed/NRGIND-34782']);
    expect(next.hidden).toEqual(['feature/SinkevichRN/Completed/NRGIND-34782']);
    expect(next.soloBranch).toBe('feature/SinkevichRN/Completed/NRGIND-34782');
    expect(next.notes['feature/SinkevichRN/Completed/NRGIND-34782']).toBe('NRGIND-31848: problem');
    expect(next.notes['feature/SinkevichRN/NRGIND-34782']).toBeUndefined();
  });

  it('returns same object when nothing to migrate', () => {
    expect(migrateBranchPrefs(base, 'missing', 'also-missing')).toBe(base);
  });

  it('no-op for identical names', () => {
    expect(migrateBranchPrefs(base, 'feature/a', 'feature/a')).toBe(base);
  });
});
