import { describe, it, expect } from 'vitest';
import { nearestFocusRef, pickFocusRef } from '../../src/renderer/src/features/graph/pickFocusRef';
import type { Commit, RefInfo } from '../../src/core/git/types';

function c(hash: string, parents: string[], refs: RefInfo[] = []): Commit {
  return {
    hash,
    parents,
    authorName: 'a',
    authorEmail: 'a@x',
    authorDate: 0,
    refs,
    subject: hash,
    isRemoteOnly: false,
  };
}

describe('pickFocusRef', () => {
  it('prefers the current local branch', () => {
    expect(pickFocusRef([
      { name: 'feature', type: 'branch' },
      { name: 'main', type: 'branch' },
    ], 'main')).toEqual({ kind: 'local', name: 'main' });
  });

  it('prefers local over remote', () => {
    expect(pickFocusRef([
      { name: 'origin/main', type: 'remote' },
      { name: 'main', type: 'branch' },
    ], 'dev')).toEqual({ kind: 'local', name: 'main' });
  });

  it('falls back to remote, then tag', () => {
    expect(pickFocusRef([{ name: 'origin/x', type: 'remote' }], 'main'))
      .toEqual({ kind: 'remote', name: 'origin/x' });
    expect(pickFocusRef([{ name: 'v1', type: 'tag' }], 'main'))
      .toEqual({ kind: 'tag', name: 'v1' });
  });

  it('ignores detached HEAD', () => {
    expect(pickFocusRef([{ name: 'HEAD', type: 'head' }], 'main')).toBeNull();
  });
});

describe('nearestFocusRef', () => {
  it('uses refs on the commit itself', () => {
    const commits = [c('tip', ['mid'], [{ name: 'main', type: 'branch' }]), c('mid', [])];
    expect(nearestFocusRef('tip', commits, 'main')).toEqual({ kind: 'local', name: 'main' });
  });

  it('walks to the nearest descendant tip', () => {
    // mid ← tip(main)
    const commits = [
      c('tip', ['mid'], [{ name: 'main', type: 'branch' }]),
      c('mid', ['old']),
      c('old', []),
    ];
    expect(nearestFocusRef('old', commits, 'main')).toEqual({ kind: 'local', name: 'main' });
  });

  it('returns null when no named ref is reachable', () => {
    const commits = [c('a', []), c('b', ['a'])];
    expect(nearestFocusRef('a', commits, 'main')).toBeNull();
  });
});
