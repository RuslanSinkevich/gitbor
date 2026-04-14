import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for writeCommands module.
 * Uses mocked GitExecutor, OperationQueue, SafetyNet, and StateManager
 * to verify command composition and error handling without real git.
 */

function createMockGit(execResult = { stdout: '', stderr: '', exitCode: 0, duration: 10 }) {
  return {
    exec: vi.fn().mockResolvedValue(execResult),
    getCwd: vi.fn().mockReturnValue('/repo'),
  };
}

function createMockQueue() {
  return {
    enqueueWrite: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    enqueueRead: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
  };
}

function createMockState() {
  return {
    refreshAll: vi.fn().mockResolvedValue(undefined),
    refreshStatusAndNotify: vi.fn().mockResolvedValue(undefined),
    setRepoPath: vi.fn(),
    switchRepo: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue({ repoPath: '/repo' }),
  };
}

function createMockSafety() {
  return {
    wrapDestructive: vi.fn(async (_op: string, _meta: unknown, fn: () => Promise<void>) => {
      await fn();
      return { success: true, rollbackAvailable: true };
    }),
  };
}

describe('writeCommands', () => {
  let Write: typeof import('@core/commands/writeCommands');

  beforeEach(async () => {
    Write = await import('@core/commands/writeCommands');
  });

  describe('stageFile', () => {
    it('calls git add with -- separator before filename', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      await Write.stageFile(queue as any, git as any, state as any, 'src/app.ts');
      expect(git.exec).toHaveBeenCalledWith(['add', '--', 'src/app.ts']);
    });

    it('protects against filenames starting with -', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      await Write.stageFile(queue as any, git as any, state as any, '-f');
      const callArgs = git.exec.mock.calls[0][0];
      expect(callArgs).toContain('--');
      const dashDashIndex = callArgs.indexOf('--');
      const fileIndex = callArgs.indexOf('-f');
      expect(dashDashIndex).toBeLessThan(fileIndex);
    });
  });

  describe('stageAll', () => {
    it('stages multiple files with -- separator', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      await Write.stageAll(queue as any, git as any, state as any, ['a.ts', 'b.ts']);
      expect(git.exec).toHaveBeenCalledWith(['add', '--', 'a.ts', 'b.ts']);
    });
  });

  describe('unstageFile', () => {
    it('uses reset HEAD -- file', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      await Write.unstageFile(queue as any, git as any, state as any, 'src/app.ts');
      expect(git.exec).toHaveBeenCalledWith(['reset', 'HEAD', '--', 'src/app.ts']);
    });
  });

  describe('commit', () => {
    it('commits with message', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      const result = await Write.commit(queue as any, git as any, state as any, 'fix: bug');
      expect(git.exec).toHaveBeenCalledWith(['commit', '-m', 'fix: bug']);
      expect(result.success).toBe(true);
    });

    it('commits with --amend', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      await Write.commit(queue as any, git as any, state as any, 'amended', true);
      expect(git.exec).toHaveBeenCalledWith(['commit', '-m', 'amended', '--amend']);
    });

    it('returns error on failure', async () => {
      const git = createMockGit({ stdout: '', stderr: 'nothing to commit', exitCode: 1, duration: 5 });
      const queue = createMockQueue();
      const state = createMockState();
      const result = await Write.commit(queue as any, git as any, state as any, 'msg');
      expect(result.success).toBe(false);
      expect(result.error).toContain('nothing to commit');
    });
  });

  describe('initRepo', () => {
    it('uses parent directory as cwd, not targetPath itself', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      await Write.initRepo(queue as any, git as any, state as any, '/home/user/new-repo');
      const callArgs = git.exec.mock.calls[0];
      expect(callArgs[0]).toEqual(['init', '/home/user/new-repo']);
      expect(callArgs[1].cwd).toBe('/home/user');
    });
  });

  describe('push', () => {
    it('pushes with --force-with-lease when force=true', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      await Write.push(queue as any, git as any, state as any, true);
      expect(git.exec).toHaveBeenCalledWith(['push', '--force-with-lease']);
    });

    it('pushes with -u origin HEAD when setUpstream=true', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      await Write.push(queue as any, git as any, state as any, false, true);
      expect(git.exec).toHaveBeenCalledWith(['push', '-u', 'origin', 'HEAD']);
    });
  });

  describe('checkout', () => {
    it('delegates to safety.wrapDestructive', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      const safety = createMockSafety();
      await Write.checkout(queue as any, git as any, safety as any, state as any, 'develop');
      expect(safety.wrapDestructive).toHaveBeenCalledWith('checkout', { branch: 'develop' }, expect.any(Function));
      expect(git.exec).toHaveBeenCalledWith(['checkout', 'develop']);
    });
  });

  describe('discardFileChanges', () => {
    it('uses checkout -- file', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      await Write.discardFileChanges(queue as any, git as any, state as any, 'src/app.ts');
      expect(git.exec).toHaveBeenCalledWith(['checkout', '--', 'src/app.ts']);
    });
  });

  describe('cloneRepo', () => {
    it('uses parent dir as cwd and sets timeout', async () => {
      const git = createMockGit();
      const queue = createMockQueue();
      const state = createMockState();
      await Write.cloneRepo(queue as any, git as any, state as any, 'https://github.com/user/repo.git', '/home/user/repo');
      const callArgs = git.exec.mock.calls[0];
      expect(callArgs[0]).toEqual(['clone', 'https://github.com/user/repo.git', '/home/user/repo']);
      expect(callArgs[1].cwd).toBe('/home/user');
      expect(callArgs[1].timeout).toBe(120_000);
    });
  });
});
