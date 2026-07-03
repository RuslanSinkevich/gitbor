import { describe, it, expect } from 'vitest';
import { migrateBranchPrefs, dropBranchPrefs, syncBranchPrefs } from '../../src/renderer/src/features/sidebar/branchPrefsPersist';

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

describe('dropBranchPrefs', () => {
  it('clears solo, pin, hide and note', () => {
    const next = dropBranchPrefs({
      pinned: ['gone', 'main'],
      hidden: ['gone'],
      soloBranch: 'gone',
      notes: { gone: 'x', main: 'y' },
    }, 'gone');
    expect(next).toEqual({ pinned: ['main'], hidden: [], soloBranch: null, notes: { main: 'y' } });
  });
});

describe('syncBranchPrefs', () => {
  it('never prunes notes, even for branches absent from localNames', () => {
    const prefs = {
      pinned: ['main'],
      hidden: [],
      soloBranch: null,
      notes: { 'feature/x': 'ticket', 'main': 'primary' },
    };
    // feature/x отсутствует в локальных ветках (напр. набор частичный/стейл),
    // но заметка должна пережить sync.
    const next = syncBranchPrefs(prefs, new Set(['main']));
    expect(next.notes).toEqual({ 'feature/x': 'ticket', 'main': 'primary' });
  });

  it('returns the same object when nothing changes', () => {
    const prefs = { pinned: ['main'], hidden: [], soloBranch: null, notes: { main: 'y' } };
    expect(syncBranchPrefs(prefs, new Set(['main']))).toBe(prefs);
  });

  it('is a no-op on empty localNames (avoids wiping on partial load)', () => {
    const prefs = { pinned: ['feature/x'], hidden: ['feature/y'], soloBranch: 'feature/z', notes: { a: 'b' } };
    expect(syncBranchPrefs(prefs, new Set())).toBe(prefs);
  });

  it('prunes pin/hide/solo for gone branches but keeps their notes', () => {
    const prefs = {
      pinned: ['gone', 'main'],
      hidden: ['gone'],
      soloBranch: 'gone',
      notes: { gone: 'still-here', main: 'y' },
    };
    const next = syncBranchPrefs(prefs, new Set(['main']));
    expect(next.pinned).toEqual(['main']);
    expect(next.hidden).toEqual([]);
    expect(next.soloBranch).toBeNull();
    expect(next.notes).toEqual({ gone: 'still-here', main: 'y' });
  });
});
