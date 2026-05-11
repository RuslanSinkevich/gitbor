import { describe, it, expect, beforeEach } from 'vitest';
import type { GitExecutor } from '@core/git/GitExecutor';
import type { OperationQueue } from '@core/safety/OperationQueue';
import type { SafetyNet } from '@core/safety/SafetyNet';
import type { StateManager } from '@core/state/StateManager';
import { makeMockGit, makeMockState, makeMockQueue, makeMockSafety } from '../_mocks';

/**
 * Tests for writeCommands module.
 * Uses mocked GitExecutor, OperationQueue, SafetyNet, and StateManager
 * to verify command composition and error handling without real git.
 *
 * Mock-объекты структурно совместимы с реальными классами, но не наследуют
 * их полностью — кастуем точечно через `as unknown as` в местах вызовов.
 */

const asGit = (m: ReturnType<typeof makeMockGit>) => m as unknown as GitExecutor;
const asQueue = (m: ReturnType<typeof makeMockQueue>) => m as unknown as OperationQueue;
const asState = (m: ReturnType<typeof makeMockState>) => m as unknown as StateManager;
const asSafety = (m: ReturnType<typeof makeMockSafety>) => m as unknown as SafetyNet;

describe('writeCommands', () => {
  let Write: typeof import('@core/commands/writeCommands');

  beforeEach(async () => {
    Write = await import('@core/commands/writeCommands');
  });

  describe('stageFile', () => {
    it('calls git add with -- separator before filename', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.stageFile(asQueue(queue), asGit(git), asState(state), 'src/app.ts');
      expect(git.exec).toHaveBeenCalledWith(['add', '--', 'src/app.ts']);
    });

    it('protects against filenames starting with -', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.stageFile(asQueue(queue), asGit(git), asState(state), '-f');
      const callArgs = git.exec.mock.calls[0][0];
      expect(callArgs).toContain('--');
      const dashDashIndex = callArgs.indexOf('--');
      const fileIndex = callArgs.indexOf('-f');
      expect(dashDashIndex).toBeLessThan(fileIndex);
    });
  });

  describe('stageAll', () => {
    it('stages multiple files with -- separator', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.stageAll(asQueue(queue), asGit(git), asState(state), ['a.ts', 'b.ts']);
      expect(git.exec).toHaveBeenCalledWith(['add', '--', 'a.ts', 'b.ts']);
    });
  });

  describe('unstageFile', () => {
    it('uses reset HEAD -- file', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.unstageFile(asQueue(queue), asGit(git), asState(state), 'src/app.ts');
      expect(git.exec).toHaveBeenCalledWith(['reset', 'HEAD', '--', 'src/app.ts']);
    });
  });

  describe('commit', () => {
    it('commits with message', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      const result = await Write.commit(asQueue(queue), asGit(git), asState(state), 'fix: bug');
      expect(git.exec).toHaveBeenCalledWith(['commit', '-m', 'fix: bug']);
      expect(result.success).toBe(true);
    });

    it('commits with --amend', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.commit(asQueue(queue), asGit(git), asState(state), 'amended', true);
      expect(git.exec).toHaveBeenCalledWith(['commit', '-m', 'amended', '--amend']);
    });

    it('returns error on failure', async () => {
      const git = makeMockGit({ stderr: 'nothing to commit', exitCode: 1 });
      const queue = makeMockQueue();
      const state = makeMockState();
      const result = await Write.commit(asQueue(queue), asGit(git), asState(state), 'msg');
      expect(result.success).toBe(false);
      expect(result.error).toContain('nothing to commit');
    });
  });

  describe('initRepo', () => {
    it('uses parent directory as cwd, not targetPath itself', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.initRepo(asQueue(queue), asGit(git), asState(state), '/home/user/new-repo');
      const callArgs = git.exec.mock.calls[0];
      expect(callArgs[0]).toEqual(['init', '/home/user/new-repo']);
      expect(callArgs[1]?.cwd).toBe('/home/user');
    });
  });

  describe('push', () => {
    it('pushes with --force-with-lease when force=true', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.push(asQueue(queue), asGit(git), asState(state), true);
      expect(git.exec).toHaveBeenCalledWith(['push', '--force-with-lease']);
    });

    it('pushes with -u origin HEAD when setUpstream=true', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.push(asQueue(queue), asGit(git), asState(state), false, true);
      expect(git.exec).toHaveBeenCalledWith(['push', '-u', 'origin', 'HEAD']);
    });
  });

  describe('checkout', () => {
    it('delegates to safety.wrapDestructive', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      const safety = makeMockSafety();
      await Write.checkout(asQueue(queue), asGit(git), asSafety(safety), asState(state), 'develop');
      expect(safety.wrapDestructive).toHaveBeenCalledWith('checkout', { branch: 'develop' }, expect.any(Function));
      expect(git.exec).toHaveBeenCalledWith(['checkout', 'develop']);
    });
  });

  describe('discardFileChanges', () => {
    it('uses checkout -- file', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.discardFileChanges(asQueue(queue), asGit(git), asState(state), 'src/app.ts');
      expect(git.exec).toHaveBeenCalledWith(['checkout', '--', 'src/app.ts']);
    });
  });

  describe('discardFiles', () => {
    it('passes all files в один git вызов', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.discardFiles(asQueue(queue), asGit(git), asState(state), ['a.ts', 'b/c.ts']);
      expect(git.exec).toHaveBeenCalledTimes(1);
      expect(git.exec).toHaveBeenCalledWith(['checkout', '--', 'a.ts', 'b/c.ts']);
    });

    it('пустой список — не дёргает git', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      const r = await Write.discardFiles(asQueue(queue), asGit(git), asState(state), []);
      expect(git.exec).not.toHaveBeenCalled();
      expect(r.success).toBe(true);
    });
  });

  describe('cloneRepo', () => {
    it('uses parent dir as cwd and sets timeout', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.cloneRepo(asQueue(queue), asGit(git), asState(state), 'https://github.com/user/repo.git', '/home/user/repo');
      const callArgs = git.exec.mock.calls[0];
      expect(callArgs[0]).toEqual(['clone', 'https://github.com/user/repo.git', '/home/user/repo']);
      expect(callArgs[1]?.cwd).toBe('/home/user');
      expect(callArgs[1]?.timeout).toBe(120_000);
    });
  });

  describe('stash', () => {
    it('runs git stash push without -m when message is undefined', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.stash(asQueue(queue), asGit(git), asState(state));
      expect(git.exec).toHaveBeenCalledWith(['stash', 'push']);
    });

    it('runs git stash push without -m when message is empty string', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.stash(asQueue(queue), asGit(git), asState(state), '');
      expect(git.exec).toHaveBeenCalledWith(['stash', 'push']);
    });

    it('appends -m and message when message is provided', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.stash(asQueue(queue), asGit(git), asState(state), 'WIP feature');
      expect(git.exec).toHaveBeenCalledWith(['stash', 'push', '-m', 'WIP feature']);
    });

    it('preserves whitespace inside the message (no trim on the backend)', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.stash(asQueue(queue), asGit(git), asState(state), '  hello world  ');
      expect(git.exec).toHaveBeenCalledWith(['stash', 'push', '-m', '  hello world  ']);
    });

    it('returns success when git exits 0', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      const r = await Write.stash(asQueue(queue), asGit(git), asState(state), 'm');
      expect(r.success).toBe(true);
    });

    it('returns failure with stderr when git exits non-zero', async () => {
      const git = makeMockGit({ stderr: 'no local changes', exitCode: 1 });
      const queue = makeMockQueue();
      const state = makeMockState();
      const r = await Write.stash(asQueue(queue), asGit(git), asState(state));
      expect(r.success).toBe(false);
      expect(r.error).toContain('no local changes');
    });
  });

  describe('stashPop', () => {
    it('runs git stash pop without args', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.stashPop(asQueue(queue), asGit(git), asState(state));
      expect(git.exec).toHaveBeenCalledWith(['stash', 'pop']);
    });
  });

  describe('stashApply', () => {
    it('runs git stash apply <index>', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.stashApply(asQueue(queue), asGit(git), asState(state), 'stash@{0}');
      expect(git.exec).toHaveBeenCalledWith(['stash', 'apply', 'stash@{0}']);
    });
  });

  describe('stashDrop', () => {
    it('runs git stash drop <index>', async () => {
      const git = makeMockGit();
      const queue = makeMockQueue();
      const state = makeMockState();
      await Write.stashDrop(asQueue(queue), asGit(git), asState(state), 'stash@{2}');
      expect(git.exec).toHaveBeenCalledWith(['stash', 'drop', 'stash@{2}']);
    });
  });
});
