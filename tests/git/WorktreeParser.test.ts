import { describe, it, expect } from 'vitest';
import type { WorktreeInfo } from '../../src/core/git/WorktreeManager';

describe('WorktreeInfo (contract)', () => {
  it('main worktree', () => {
    const wt: WorktreeInfo = {
      path: '/home/user/repo',
      branch: 'main',
      hash: 'abc1234',
      isBare: false,
      isMain: true,
    };
    expect(wt.isMain).toBe(true);
    expect(wt.isBare).toBe(false);
    expect(wt.branch).toBe('main');
  });

  it('secondary worktree', () => {
    const wt: WorktreeInfo = {
      path: '/home/user/repo-feature',
      branch: 'feature/new',
      hash: 'def5678',
      isBare: false,
      isMain: false,
    };
    expect(wt.isMain).toBe(false);
    expect(wt.branch).toBe('feature/new');
  });

  it('bare worktree', () => {
    const wt: WorktreeInfo = {
      path: '/srv/bare.git',
      branch: '',
      hash: '',
      isBare: true,
      isMain: true,
    };
    expect(wt.isBare).toBe(true);
  });

  it('detached worktree', () => {
    const wt: WorktreeInfo = {
      path: '/tmp/detached',
      branch: '(detached)',
      hash: '1234abc',
      isBare: false,
      isMain: false,
    };
    expect(wt.branch).toBe('(detached)');
  });
});
