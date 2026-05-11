import { describe, it, expect } from 'vitest';
import {
  emptyRepoSlice,
  mirrorRepoSliceToAppState,
  hashGitStdout,
  GIT_LOG_FORMAT,
  GIT_REF_FORMAT,
  GIT_TAG_REF_FORMAT,
  GIT_STASH_FORMAT,
} from '../../src/core/state/repoSlice';
import type { AppState, Branch, Commit } from '../../src/core/git/types';

/**
 * `repoSlice` — pure-функции, выделенные из StateManager. Тесты гарантируют:
 * - `emptyRepoSlice` возвращает свежий объект (не shared между вызовами);
 * - `mirrorRepoSliceToAppState` копирует ровно те поля, что репо-специфичны,
 *   и не трогает meta (`openRepos`/`activeRepoIndex`/running-флаги);
 * - `hashGitStdout` детерминирован и различает разные строки;
 * - GIT_*_FORMAT константы не мутировались случайно.
 */
describe('repoSlice', () => {
  describe('emptyRepoSlice', () => {
    it('returns a fresh object each call', () => {
      const a = emptyRepoSlice();
      const b = emptyRepoSlice();
      expect(a).not.toBe(b);
      expect(a.branches).not.toBe(b.branches);
      expect(a.commits).not.toBe(b.commits);
      expect(a.graphLayout).not.toBe(b.graphLayout);
    });

    it('has the expected default shape', () => {
      const s = emptyRepoSlice();
      expect(s.currentBranch).toBe('');
      expect(s.branches).toEqual([]);
      expect(s.tags).toEqual([]);
      expect(s.stashes).toEqual([]);
      expect(s.remotes).toEqual([]);
      expect(s.stagedFiles).toEqual([]);
      expect(s.unstagedFiles).toEqual([]);
      expect(s.conflicts).toEqual([]);
      expect(s.ahead).toBe(0);
      expect(s.behind).toBe(0);
      expect(s.commits).toEqual([]);
      expect(s.graphLayout).toEqual({ nodes: [], maxColumns: 0, mergeLinks: [] });
      expect(s.selectedCommitHash).toBeNull();
      expect(s.cachedHeadHash).toBeNull();
      expect(s.cachedLogHash).toBeNull();
      expect(s.cachedLogLimit).toBe(0);
      expect(s.token).toBe(0);
    });
  });

  describe('mirrorRepoSliceToAppState', () => {
    function makeState(): AppState {
      return {
        repoPath: '/r',
        repoName: 'r',
        currentBranch: 'old',
        branches: [],
        tags: [],
        stashes: [],
        remotes: [],
        stagedFiles: [],
        unstagedFiles: [],
        conflicts: [],
        ahead: 0,
        behind: 0,
        commits: [],
        graphLayout: { nodes: [], maxColumns: 0, mergeLinks: [] },
        selectedCommitHash: null,
        isOperationRunning: true,
        currentOperation: 'pull',
        openRepos: [{ name: 'r', path: '/r' }],
        activeRepoIndex: 0,
      };
    }

    it('copies repo-specific fields by reference', () => {
      const state = makeState();
      const slice = emptyRepoSlice();
      slice.currentBranch = 'main';
      slice.branches = [{ name: 'main', isRemote: false, currentBranch: true } as unknown as Branch];
      slice.commits = [{ hash: 'aaa1' } as unknown as Commit];
      slice.ahead = 3;
      slice.behind = 1;

      mirrorRepoSliceToAppState(state, slice);

      expect(state.currentBranch).toBe('main');
      expect(state.branches).toBe(slice.branches);
      expect(state.commits).toBe(slice.commits);
      expect(state.ahead).toBe(3);
      expect(state.behind).toBe(1);
    });

    it('does NOT touch meta fields (openRepos / activeRepoIndex / running)', () => {
      const state = makeState();
      const originalOpenRepos = state.openRepos;
      const slice = emptyRepoSlice();
      mirrorRepoSliceToAppState(state, slice);
      expect(state.openRepos).toBe(originalOpenRepos);
      expect(state.activeRepoIndex).toBe(0);
      // running-флаги в main теперь no-op, но если кто-то их выставил —
      // mirror не должен затереть.
      expect(state.isOperationRunning).toBe(true);
      expect(state.currentOperation).toBe('pull');
    });
  });

  describe('hashGitStdout', () => {
    it('is deterministic for identical input', () => {
      const s = 'aaa1\x00\x00Alice\x00a@x\x001700000000\x00\x00c1\x00N\n';
      expect(hashGitStdout(s)).toBe(hashGitStdout(s));
    });

    it('produces different hashes for different inputs', () => {
      const a = hashGitStdout('foo');
      const b = hashGitStdout('bar');
      expect(a).not.toBe(b);
    });

    it('returns md5 hex (32 chars)', () => {
      const h = hashGitStdout('hello world');
      expect(h).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe('GIT format constants', () => {
    it('use NUL separator for log lines', () => {
      expect(GIT_LOG_FORMAT).toContain('%H');
      expect(GIT_LOG_FORMAT).toContain('%P');
      expect(GIT_LOG_FORMAT).toContain('%x00');
      // Парсер опирается на 8 NUL-разделённых полей.
      expect(GIT_LOG_FORMAT.split('%x00').length).toBe(8);
    });

    it('ref format produces 4 NUL-fields', () => {
      expect(GIT_REF_FORMAT).toContain('refname:short');
      expect(GIT_REF_FORMAT.split('%00').length).toBe(4);
    });

    it('tag ref format produces 2 NUL-fields', () => {
      expect(GIT_TAG_REF_FORMAT.split('%00').length).toBe(2);
    });

    it('stash format includes %gd and %gs', () => {
      expect(GIT_STASH_FORMAT).toContain('%gd');
      expect(GIT_STASH_FORMAT).toContain('%gs');
    });
  });
});
