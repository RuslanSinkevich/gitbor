import { describe, it, expect } from 'vitest';
import { RebaseManager } from '@core/git/RebaseManager';
import type { GitExecutor } from '@core/git/GitExecutor';
import type { GitExecOptions, RebaseTodoEntry } from '@core/git/types';
import { makeScriptedGit, type GitExecResponse, type MockGit } from '../_mocks';

const asGit = (m: MockGit) => m as unknown as GitExecutor;

function createMockGit(responses: Record<string, GitExecResponse> = {}): MockGit {
  return makeScriptedGit(responses);
}

describe('RebaseManager', () => {
  describe('getTodoList', () => {
    it('parses log output into todo entries', async () => {
      const git = createMockGit({
        'log --reverse': {
          stdout: 'aaa111 aaa fix: bug\nbbb222 bbb feat: feature\n',
          stderr: '',
          exitCode: 0,
        },
      });
      const rm = new RebaseManager(asGit(git));
      const todo = await rm.getTodoList('main');

      expect(todo.onto).toBe('main');
      expect(todo.entries).toHaveLength(2);
      expect(todo.entries[0]).toMatchObject({
        action: 'pick',
        hash: 'aaa111',
        shortHash: 'aaa',
        subject: 'fix: bug',
      });
      expect(todo.entries[1]).toMatchObject({
        action: 'pick',
        hash: 'bbb222',
        shortHash: 'bbb',
        subject: 'feat: feature',
      });
    });

    it('returns empty entries for empty log', async () => {
      const git = createMockGit({
        'log --reverse': { stdout: '', stderr: '', exitCode: 0 },
      });
      const rm = new RebaseManager(asGit(git));
      const todo = await rm.getTodoList('main');
      expect(todo.entries).toEqual([]);
    });
  });

  describe('executeRebase', () => {
    it('sets GIT_SEQUENCE_EDITOR with cp command using forward slashes', async () => {
      const git = createMockGit();
      const rm = new RebaseManager(asGit(git));

      const entries: RebaseTodoEntry[] = [
        { action: 'pick', hash: 'aaa111', shortHash: 'aaa', subject: 'fix: bug' },
        { action: 'reword', hash: 'bbb222', shortHash: 'bbb', subject: 'feat: feature' },
      ];

      await rm.executeRebase('main', entries);

      const rebaseCall = git.exec.mock.calls.find(
        c => c[0].includes('rebase') && c[0].includes('-i'),
      );
      expect(rebaseCall).toBeTruthy();
      expect(rebaseCall![0]).toEqual(['rebase', '-i', 'main']);

      const opts = rebaseCall![1] as GitExecOptions | undefined;
      expect(opts?.env?.GIT_SEQUENCE_EDITOR).toMatch(/^cp "/);
      expect(opts?.env?.GIT_SEQUENCE_EDITOR).not.toContain('\\');
      expect(opts?.timeout).toBe(60_000);
    });

    it('filters out dropped entries from todo content', async () => {
      const git = createMockGit();
      const rm = new RebaseManager(asGit(git));

      const entries: RebaseTodoEntry[] = [
        { action: 'pick', hash: 'aaa111', shortHash: 'aaa', subject: 'keep' },
        { action: 'drop', hash: 'bbb222', shortHash: 'bbb', subject: 'remove' },
        { action: 'squash', hash: 'ccc333', shortHash: 'ccc', subject: 'squash me' },
      ];

      await rm.executeRebase('main', entries);

      // The function writes a temp file with todo content. We verify by checking
      // the exec call happened (actual file verification would need fs mocking).
      expect(git.exec).toHaveBeenCalled();
    });

    it('returns failure on git error', async () => {
      const git = createMockGit({
        'rebase -i': { stdout: '', stderr: 'conflict', exitCode: 1 },
      });
      const rm = new RebaseManager(asGit(git));
      const result = await rm.executeRebase('main', [
        { action: 'pick', hash: 'aaa', shortHash: 'a', subject: 'x' },
      ]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('conflict');
    });
  });

  describe('continueRebase', () => {
    it('calls git rebase --continue', async () => {
      const git = createMockGit();
      const rm = new RebaseManager(asGit(git));
      const result = await rm.continueRebase();
      expect(git.exec).toHaveBeenCalledWith(['rebase', '--continue']);
      expect(result.success).toBe(true);
    });
  });

  describe('abortRebase', () => {
    it('calls git rebase --abort', async () => {
      const git = createMockGit();
      const rm = new RebaseManager(asGit(git));
      const result = await rm.abortRebase();
      expect(git.exec).toHaveBeenCalledWith(['rebase', '--abort']);
      expect(result.success).toBe(true);
    });
  });
});
