import { describe, it, expect } from 'vitest';
import {
  focusBranchNameForOp,
  hashesMatch,
  resolveGraphFocus,
  shouldFocusAfterOp,
  type PendingGraphFocus,
} from '../../src/renderer/src/features/graph/graphFocus';
import type { Branch, Commit } from '../../src/core/git/types';

function commit(hash: string): Commit {
  return {
    hash,
    parents: [],
    authorName: 'a',
    authorEmail: 'a@x',
    authorDate: 0,
    refs: [],
    subject: hash,
    isRemoteOnly: false,
  };
}

function branch(name: string, hash: string, extra: Partial<Branch> = {}): Branch {
  return { name, hash, isCurrent: false, isRemote: false, ...extra };
}

const repo = '/repo';
const tip = 'aaa111';
const oldTip = 'bbb222';
const commitsNow = [commit(tip), commit(oldTip)];
const commitsOld = [commit(oldTip)];

function pending(partial: Partial<PendingGraphFocus> = {}): PendingGraphFocus {
  return {
    operation: 'commit',
    repoPath: repo,
    commitsAtEnd: commitsOld,
    ...partial,
  };
}

describe('shouldFocusAfterOp', () => {
  it('accepts HEAD-moving and named-ref ops', () => {
    expect(shouldFocusAfterOp('commit')).toBe(true);
    expect(shouldFocusAfterOp('merge')).toBe(true);
    expect(shouldFocusAfterOp('cherry-pick')).toBe(true);
    expect(shouldFocusAfterOp('fetchBranch')).toBe(true);
    expect(shouldFocusAfterOp('createBranch')).toBe(true);
  });

  it('rejects fetch-all, delete, stash', () => {
    expect(shouldFocusAfterOp('fetch')).toBe(false);
    expect(shouldFocusAfterOp('deleteBranch')).toBe(false);
    expect(shouldFocusAfterOp('stash')).toBe(false);
    expect(shouldFocusAfterOp(undefined)).toBe(false);
  });
});

describe('focusBranchNameForOp', () => {
  it('reads fetchBranch.branch and createBranch.name', () => {
    expect(focusBranchNameForOp('fetchBranch', { type: 'fetchBranch', branch: 'feature' }))
      .toBe('feature');
    expect(focusBranchNameForOp('createBranch', { type: 'createBranch', name: 'hotfix' }))
      .toBe('hotfix');
  });

  it('ignores mismatched command or HEAD ops', () => {
    expect(focusBranchNameForOp('commit', { type: 'commit' })).toBeUndefined();
    expect(focusBranchNameForOp('fetchBranch', { type: 'push' })).toBeUndefined();
    expect(focusBranchNameForOp('fetchBranch', null)).toBeUndefined();
  });
});

describe('hashesMatch', () => {
  it('matches full vs short SHA', () => {
    expect(hashesMatch('abcdef1234', 'abcdef')).toBe(true);
    expect(hashesMatch('abc', 'abcdef')).toBe(true);
    expect(hashesMatch('aaaa', 'bbbb')).toBe(false);
    expect(hashesMatch('', 'abc')).toBe(false);
  });
});

describe('resolveGraphFocus', () => {
  const current = branch('main', tip, { isCurrent: true });

  it('drops when repo changed', () => {
    expect(resolveGraphFocus(pending(), {
      repoPath: '/other',
      commits: commitsNow,
      branches: [current],
    })).toEqual({ kind: 'drop' });
  });

  it('waits when current tip is not in the graph yet', () => {
    expect(resolveGraphFocus(pending(), {
      repoPath: repo,
      commits: commitsOld,
      branches: [current],
    })).toEqual({ kind: 'wait' });
  });

  it('waits for a new commits[] after deferHeavy ops', () => {
    expect(resolveGraphFocus(pending({ operation: 'commit', commitsAtEnd: commitsNow }), {
      repoPath: repo,
      commits: commitsNow,
      branches: [current],
    })).toEqual({ kind: 'wait' });
  });

  it('focuses current HEAD after commits refresh', () => {
    expect(resolveGraphFocus(pending({ operation: 'commit' }), {
      repoPath: repo,
      commits: commitsNow,
      branches: [current],
    })).toEqual({ kind: 'focus', hash: tip, branchName: undefined });
  });

  it('does not wait for commits[] on checkout / fetchBranch / createBranch', () => {
    expect(resolveGraphFocus(pending({
      operation: 'checkout',
      commitsAtEnd: commitsNow,
    }), {
      repoPath: repo,
      commits: commitsNow,
      branches: [current],
    })).toEqual({ kind: 'focus', hash: tip, branchName: undefined });
  });

  it('focuses the named branch after fetchBranch, not HEAD', () => {
    const feature = branch('feature', tip);
    expect(resolveGraphFocus(pending({
      operation: 'fetchBranch',
      branchName: 'feature',
      commitsAtEnd: commitsNow,
    }), {
      repoPath: repo,
      commits: commitsNow,
      branches: [current, feature],
    })).toEqual({ kind: 'focus', hash: tip, branchName: 'feature' });
  });

  it('ignores a remote with the same name as the local target', () => {
    expect(resolveGraphFocus(pending({
      operation: 'fetchBranch',
      branchName: 'feature',
      commitsAtEnd: commitsNow,
    }), {
      repoPath: repo,
      commits: commitsNow,
      branches: [current, branch('feature', 'deadbee', { isRemote: true })],
    })).toEqual({ kind: 'wait' });
  });

  it('skipWait focuses even if commits[] identity did not change', () => {
    expect(resolveGraphFocus(pending({
      operation: null,
      commitsAtEnd: commitsNow,
      skipWait: true,
    }), {
      repoPath: repo,
      commits: commitsNow,
      branches: [current],
    })).toEqual({ kind: 'focus', hash: tip, branchName: undefined });
  });
});
