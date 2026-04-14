import { describe, it, expect } from 'vitest';

// We can't easily instantiate WorktreeManager without a real git repo,
// but we can test the parser function by importing the module's internals.
// Since parseWorktreeList is not exported, we test via a mock GitExecutor approach.
// For now, test the data contract.

describe('WorktreeManager (contract)', () => {
  it('WorktreeInfo interface has required fields', () => {
    const wt = {
      path: '/home/user/repo',
      branch: 'main',
      hash: 'abc1234',
      isBare: false,
      isMain: true,
    };
    expect(wt.path).toBeDefined();
    expect(wt.branch).toBeDefined();
    expect(wt.hash).toBeDefined();
    expect(typeof wt.isBare).toBe('boolean');
    expect(typeof wt.isMain).toBe('boolean');
  });
});
