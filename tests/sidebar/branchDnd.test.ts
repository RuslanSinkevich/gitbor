import { describe, it, expect } from 'vitest';
import { computeMovedBranchName } from '../../src/renderer/src/features/sidebar/branchDnd';

describe('computeMovedBranchName', () => {
  it('moves feature/a → archive/a', () => {
    expect(computeMovedBranchName('feature/a', 'archive')).toBe('archive/a');
  });

  it('moves feature/sub/x → root (empty target) → x', () => {
    expect(computeMovedBranchName('feature/sub/x', '')).toBe('x');
  });

  it('moves main → release → release/main', () => {
    expect(computeMovedBranchName('main', 'release')).toBe('release/main');
  });

  it('preserves leaf when moving between nested folders', () => {
    expect(computeMovedBranchName('feature/deep/branch-name', 'hotfix')).toBe('hotfix/branch-name');
  });
});
