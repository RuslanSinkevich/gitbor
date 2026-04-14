import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictManager } from '@core/commands/ConflictManager';

function createMockGit(responses: Record<string, { stdout: string; stderr: string; exitCode: number }> = {}) {
  const defaultResponse = { stdout: '', stderr: '', exitCode: 0, duration: 5 };
  return {
    exec: vi.fn(async (args: string[]) => {
      const key = args.join(' ');
      for (const [pattern, resp] of Object.entries(responses)) {
        if (key.includes(pattern)) return { ...defaultResponse, ...resp };
      }
      return defaultResponse;
    }),
    getCwd: vi.fn().mockReturnValue('/repo'),
  };
}

function createMockState() {
  return {
    getState: vi.fn().mockReturnValue({ repoPath: '/repo' }),
    refreshAll: vi.fn(),
    refreshStatusAndNotify: vi.fn(),
  };
}

describe('ConflictManager', () => {
  describe('completeMerge', () => {
    it('returns success when commit succeeds', async () => {
      const git = createMockGit({
        'diff --name-only --diff-filter=U': { stdout: '', stderr: '', exitCode: 0 },
        'status --porcelain': { stdout: '', stderr: '', exitCode: 0 },
        'commit --no-edit': { stdout: '', stderr: '', exitCode: 0 },
      });
      const cm = new ConflictManager(git as any, createMockState() as any);
      const result = await cm.completeMerge();
      expect(result.success).toBe(true);
    });

    it('returns failure when commit fails', async () => {
      const git = createMockGit({
        'diff --name-only --diff-filter=U': { stdout: '', stderr: '', exitCode: 0 },
        'status --porcelain': { stdout: '', stderr: '', exitCode: 0 },
        'commit --no-edit': { stdout: '', stderr: 'nothing to commit', exitCode: 1 },
      });
      const cm = new ConflictManager(git as any, createMockState() as any);
      const result = await cm.completeMerge();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Commit failed');
    });

    it('returns failure when unresolved conflicts exist', async () => {
      const git = createMockGit({
        'diff --name-only --diff-filter=U': { stdout: 'src/app.ts\n', stderr: '', exitCode: 0 },
      });
      const cm = new ConflictManager(git as any, createMockState() as any);
      const result = await cm.completeMerge();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not all conflicts');
    });

    it('passes custom message to commit', async () => {
      const git = createMockGit({
        'diff --name-only --diff-filter=U': { stdout: '', stderr: '', exitCode: 0 },
        'status --porcelain': { stdout: '', stderr: '', exitCode: 0 },
        'commit -m': { stdout: '', stderr: '', exitCode: 0 },
      });
      const cm = new ConflictManager(git as any, createMockState() as any);
      await cm.completeMerge('Merge: custom message');
      const commitCall = git.exec.mock.calls.find((c: string[][]) => c[0].includes('commit'));
      expect(commitCall).toBeTruthy();
      expect(commitCall![0]).toContain('-m');
      expect(commitCall![0]).toContain('Merge: custom message');
    });
  });

  describe('resolveWithOurs', () => {
    it('uses -- before file path in both checkout and add', async () => {
      const git = createMockGit();
      const cm = new ConflictManager(git as any, createMockState() as any);
      await cm.resolveWithOurs('src/conflict.ts');

      const checkoutCall = git.exec.mock.calls[0][0];
      expect(checkoutCall).toEqual(['checkout', '--ours', '--', 'src/conflict.ts']);

      const addCall = git.exec.mock.calls[1][0];
      expect(addCall).toEqual(['add', '--', 'src/conflict.ts']);
    });
  });

  describe('resolveWithTheirs', () => {
    it('uses -- before file path', async () => {
      const git = createMockGit();
      const cm = new ConflictManager(git as any, createMockState() as any);
      await cm.resolveWithTheirs('-dangerous-file');

      const checkoutCall = git.exec.mock.calls[0][0];
      expect(checkoutCall).toEqual(['checkout', '--theirs', '--', '-dangerous-file']);

      const addCall = git.exec.mock.calls[1][0];
      expect(addCall).toEqual(['add', '--', '-dangerous-file']);
    });
  });

  describe('merge', () => {
    it('returns success on clean merge', async () => {
      const git = createMockGit({
        merge: { stdout: 'Fast-forward', stderr: '', exitCode: 0 },
      });
      const cm = new ConflictManager(git as any, createMockState() as any);
      const result = await cm.merge('feature', { noCommit: false, squash: false, ffOnly: false, noFf: false });
      expect(result.success).toBe(true);
      expect(result.conflicts).toEqual([]);
    });

    it('passes merge options correctly', async () => {
      const git = createMockGit();
      const cm = new ConflictManager(git as any, createMockState() as any);
      await cm.merge('feature', { noCommit: true, squash: true, ffOnly: false, noFf: true });

      const mergeCall = git.exec.mock.calls[0][0];
      expect(mergeCall).toContain('--no-commit');
      expect(mergeCall).toContain('--squash');
      expect(mergeCall).toContain('--no-ff');
      expect(mergeCall).not.toContain('--ff-only');
    });
  });

  describe('predictConflicts', () => {
    it('returns empty on error', async () => {
      const git = createMockGit({
        'merge-base': { stdout: '', stderr: 'error', exitCode: 1 },
      });
      const cm = new ConflictManager(git as any, createMockState() as any);
      const result = await cm.predictConflicts('feature', 'main');
      expect(result).toEqual([]);
    });
  });
});
