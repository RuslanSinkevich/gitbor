import { describe, it, expect } from 'vitest';
import { WorktreeManager } from '@core/git/WorktreeManager';
import type { GitExecutor } from '@core/git/GitExecutor';
import { makeMockGit, type MockGit } from '../_mocks';

const asGit = (m: MockGit) => m as unknown as GitExecutor;

function createMockGit(stdout: string): MockGit {
  return makeMockGit({ stdout });
}

describe('WorktreeManager', () => {
  describe('list', () => {
    it('parses porcelain output with main and linked worktrees', async () => {
      const porcelain = [
        'worktree /home/user/repo',
        'HEAD abc1234567890abcdef1234567890abcdef123456',
        'branch refs/heads/main',
        '',
        'worktree /home/user/repo-feature',
        'HEAD def5678901234567890abcdef1234567890abcdef',
        'branch refs/heads/feature/new',
        '',
      ].join('\n');

      const git = createMockGit(porcelain);
      const wm = new WorktreeManager(asGit(git));
      const result = await wm.list();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        path: '/home/user/repo',
        branch: 'main',
        isMain: true,
        isBare: false,
      });
      expect(result[1]).toMatchObject({
        path: '/home/user/repo-feature',
        branch: 'feature/new',
        isMain: false,
        isBare: false,
      });
    });

    it('parses detached worktree', async () => {
      const porcelain = [
        'worktree /repo',
        'HEAD abc1234567890abcdef1234567890abcdef123456',
        'branch refs/heads/main',
        '',
        'worktree /tmp/detached',
        'HEAD 1234abc567890abcdef1234567890abcdef123456',
        'detached',
        '',
      ].join('\n');

      const git = createMockGit(porcelain);
      const wm = new WorktreeManager(asGit(git));
      const result = await wm.list();

      expect(result[1].branch).toBe('(detached)');
      expect(result[1].isMain).toBe(false);
    });

    it('parses bare worktree', async () => {
      const porcelain = [
        'worktree /srv/bare.git',
        'bare',
        '',
      ].join('\n');

      const git = createMockGit(porcelain);
      const wm = new WorktreeManager(asGit(git));
      const result = await wm.list();

      expect(result).toHaveLength(1);
      expect(result[0].isBare).toBe(true);
      expect(result[0].isMain).toBe(true);
    });

    it('returns empty array for empty output', async () => {
      const git = createMockGit('');
      const wm = new WorktreeManager(asGit(git));
      const result = await wm.list();
      expect(result).toEqual([]);
    });

    it('calls git with correct args', async () => {
      const git = createMockGit('');
      const wm = new WorktreeManager(asGit(git));
      await wm.list();
      expect(git.exec).toHaveBeenCalledWith(['worktree', 'list', '--porcelain']);
    });
  });

  describe('add', () => {
    it('creates branch with -b flag when createBranch=true', async () => {
      const git = createMockGit('');
      const wm = new WorktreeManager(asGit(git));
      await wm.add('/tmp/wt', 'new-branch', true);
      expect(git.exec).toHaveBeenCalledWith(['worktree', 'add', '-b', 'new-branch', '/tmp/wt']);
    });

    it('uses existing branch without -b flag', async () => {
      const git = createMockGit('');
      const wm = new WorktreeManager(asGit(git));
      await wm.add('/tmp/wt', 'existing-branch', false);
      expect(git.exec).toHaveBeenCalledWith(['worktree', 'add', '/tmp/wt', 'existing-branch']);
    });
  });

  describe('remove', () => {
    it('removes with --force when force=true', async () => {
      const git = createMockGit('');
      const wm = new WorktreeManager(asGit(git));
      await wm.remove('/tmp/wt', true);
      expect(git.exec).toHaveBeenCalledWith(['worktree', 'remove', '--force', '/tmp/wt']);
    });

    it('removes without --force normally', async () => {
      const git = createMockGit('');
      const wm = new WorktreeManager(asGit(git));
      await wm.remove('/tmp/wt', false);
      expect(git.exec).toHaveBeenCalledWith(['worktree', 'remove', '/tmp/wt']);
    });
  });
});
