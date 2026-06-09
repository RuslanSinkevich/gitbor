import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConflictManager } from '@core/commands/ConflictManager';
import type { GitExecutor } from '@core/git/GitExecutor';
import { makeScriptedGit, makeMockGit, type GitExecResponse, type MockGit } from '../_mocks';
import type { GitExecResult } from '@core/git/types';

const asGit = (m: MockGit) => m as unknown as GitExecutor;

function createScriptedGit(responses: Record<string, GitExecResponse> = {}): MockGit {
  return makeScriptedGit(responses);
}

describe('ConflictManager', () => {
  describe('completeMerge', () => {
    it('returns success when commit succeeds', async () => {
      const git = createScriptedGit({
        'diff --name-only --diff-filter=U': { stdout: '', stderr: '', exitCode: 0 },
        'status --porcelain': { stdout: '', stderr: '', exitCode: 0 },
        'commit --no-edit': { stdout: '', stderr: '', exitCode: 0 },
      });
      const cm = new ConflictManager(asGit(git));
      const result = await cm.completeMerge();
      expect(result.success).toBe(true);
    });

    it('returns failure when commit fails', async () => {
      const git = createScriptedGit({
        'diff --name-only --diff-filter=U': { stdout: '', stderr: '', exitCode: 0 },
        'status --porcelain': { stdout: '', stderr: '', exitCode: 0 },
        'commit --no-edit': { stdout: '', stderr: 'nothing to commit', exitCode: 1 },
      });
      const cm = new ConflictManager(asGit(git));
      const result = await cm.completeMerge();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Commit failed');
    });

    it('returns failure when unresolved conflicts exist', async () => {
      const git = createScriptedGit({
        'diff --name-only --diff-filter=U': { stdout: 'src/app.ts\n', stderr: '', exitCode: 0 },
      });
      const cm = new ConflictManager(asGit(git));
      const result = await cm.completeMerge();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not all conflicts');
    });

    it('passes custom message to commit', async () => {
      const git = createScriptedGit({
        'diff --name-only --diff-filter=U': { stdout: '', stderr: '', exitCode: 0 },
        'status --porcelain': { stdout: '', stderr: '', exitCode: 0 },
        'commit -m': { stdout: '', stderr: '', exitCode: 0 },
      });
      const cm = new ConflictManager(asGit(git));
      await cm.completeMerge('Merge: custom message');
      const commitCall = git.exec.mock.calls.find(c => c[0].includes('commit'));
      expect(commitCall).toBeTruthy();
      expect(commitCall![0]).toContain('-m');
      expect(commitCall![0]).toContain('Merge: custom message');
    });
  });

  describe('resolveWithOurs', () => {
    it('uses -- before file path in both checkout and add', async () => {
      const git = makeMockGit();
      const dir = mkdtempSync(join(tmpdir(), 'gitbor-conflict-'));
      git.getCwd.mockReturnValue(dir);
      git.exec.mockImplementation(async (args) => {
        if (args[0] === 'checkout') {
          mkdirSync(join(dir, 'src'), { recursive: true });
          writeFileSync(join(dir, 'src/conflict.ts'), 'resolved');
        }
        return { stdout: '', stderr: '', exitCode: 0, duration: 5 };
      });
      const cm = new ConflictManager(asGit(git));
      try {
        await cm.resolveWithOurs('src/conflict.ts');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }

      const checkoutCall = git.exec.mock.calls[0][0];
      expect(checkoutCall).toEqual(['checkout', '--ours', '--', 'src/conflict.ts']);

      const addCall = git.exec.mock.calls[1][0];
      expect(addCall).toEqual(['add', '--', 'src/conflict.ts']);
    });

    it('uses git rm when chosen side deleted the file', async () => {
      const git = makeMockGit();
      const dir = mkdtempSync(join(tmpdir(), 'gitbor-conflict-'));
      git.getCwd.mockReturnValue(dir);
      const cm = new ConflictManager(asGit(git));
      try {
        await cm.resolveWithOurs('src/deleted.ts');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }

      expect(git.exec.mock.calls[0][0]).toEqual(['checkout', '--ours', '--', 'src/deleted.ts']);
      expect(git.exec.mock.calls[1][0]).toEqual(['rm', '-f', '--', 'src/deleted.ts']);
    });
  });

  describe('resolveWithTheirs', () => {
    it('uses -- before file path', async () => {
      const git = makeMockGit();
      const dir = mkdtempSync(join(tmpdir(), 'gitbor-conflict-'));
      git.getCwd.mockReturnValue(dir);
      git.exec.mockImplementation(async (args) => {
        if (args[0] === 'checkout') {
          writeFileSync(join(dir, '-dangerous-file'), 'resolved');
        }
        return { stdout: '', stderr: '', exitCode: 0, duration: 5 };
      });
      const cm = new ConflictManager(asGit(git));
      try {
        await cm.resolveWithTheirs('-dangerous-file');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }

      const checkoutCall = git.exec.mock.calls[0][0];
      expect(checkoutCall).toEqual(['checkout', '--theirs', '--', '-dangerous-file']);

      const addCall = git.exec.mock.calls[1][0];
      expect(addCall).toEqual(['add', '--', '-dangerous-file']);
    });
  });

  describe('merge', () => {
    it('returns success on clean merge', async () => {
      const git = createScriptedGit({
        merge: { stdout: 'Fast-forward', stderr: '', exitCode: 0 },
      });
      const cm = new ConflictManager(asGit(git));
      const result = await cm.merge('feature', { noCommit: false, squash: false, ffOnly: false, noFf: false });
      expect(result.success).toBe(true);
      expect(result.conflicts).toEqual([]);
    });

    it('passes merge options correctly', async () => {
      const git = makeMockGit();
      const cm = new ConflictManager(asGit(git));
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
      const git = createScriptedGit({
        'merge-base': { stdout: '', stderr: 'error', exitCode: 1 },
      });
      const cm = new ConflictManager(asGit(git));
      const result = await cm.predictConflicts('feature', 'main');
      expect(result).toEqual([]);
    });
  });

  describe('detectConflictResolution', () => {
    let repoDir: string;
    let gitDir: string;

    beforeEach(() => {
      repoDir = mkdtempSync(join(tmpdir(), 'gitbor-cm-detect-'));
      gitDir = join(repoDir, '.git');
      mkdirSync(gitDir, { recursive: true });
    });
    afterEach(() => {
      try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    function makeGit(uuFiles: string[] = []): MockGit {
      return {
        exec: vi.fn(async (args: string[]): Promise<GitExecResult> => {
          if (args.join(' ') === 'diff --name-only --diff-filter=U') {
            return { stdout: uuFiles.join('\n'), stderr: '', exitCode: 0, duration: 1 };
          }
          return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
        }),
        getCwd: vi.fn(() => repoDir),
      };
    }

    it('returns inProgress=false on clean state', async () => {
      const cm = new ConflictManager(asGit(makeGit()));
      const r = await cm.detectConflictResolution();
      expect(r.inProgress).toBe(false);
    });

    it('MERGE_HEAD → kind=merge', async () => {
      writeFileSync(join(gitDir, 'MERGE_HEAD'), '');
      const cm = new ConflictManager(asGit(makeGit()));
      const r = await cm.detectConflictResolution();
      expect(r.inProgress).toBe(true);
      if (r.inProgress) expect(r.kind).toBe('merge');
    });

    it('CHERRY_PICK_HEAD → kind=cherry-pick', async () => {
      writeFileSync(join(gitDir, 'CHERRY_PICK_HEAD'), '');
      const cm = new ConflictManager(asGit(makeGit()));
      const r = await cm.detectConflictResolution();
      expect(r.inProgress).toBe(true);
      if (r.inProgress) expect(r.kind).toBe('cherry-pick');
    });

    it('REVERT_HEAD → kind=revert', async () => {
      writeFileSync(join(gitDir, 'REVERT_HEAD'), '');
      const cm = new ConflictManager(asGit(makeGit()));
      const r = await cm.detectConflictResolution();
      expect(r.inProgress).toBe(true);
      if (r.inProgress) expect(r.kind).toBe('revert');
    });

    it('rebase-apply dir → kind=rebase', async () => {
      mkdirSync(join(gitDir, 'rebase-apply'));
      const cm = new ConflictManager(asGit(makeGit()));
      const r = await cm.detectConflictResolution();
      expect(r.inProgress).toBe(true);
      if (r.inProgress) expect(r.kind).toBe('rebase');
    });

    it('rebase-merge dir → kind=rebase', async () => {
      mkdirSync(join(gitDir, 'rebase-merge'));
      const cm = new ConflictManager(asGit(makeGit()));
      const r = await cm.detectConflictResolution();
      expect(r.inProgress).toBe(true);
      if (r.inProgress) expect(r.kind).toBe('rebase');
    });

    it('only UU files without any HEAD-files → kind=unmerged-paths', async () => {
      const cm = new ConflictManager(asGit(makeGit(['src/a.ts', 'src/b.ts'])));
      const r = await cm.detectConflictResolution();
      expect(r.inProgress).toBe(true);
      if (r.inProgress) expect(r.kind).toBe('unmerged-paths');
    });

    it('MERGE_HEAD wins over UU (precedence)', async () => {
      writeFileSync(join(gitDir, 'MERGE_HEAD'), '');
      const cm = new ConflictManager(asGit(makeGit(['src/a.ts'])));
      const r = await cm.detectConflictResolution();
      expect(r.inProgress).toBe(true);
      if (r.inProgress) expect(r.kind).toBe('merge');
    });
  });

  describe('getMergeState includes kind', () => {
    let repoDir: string;
    let gitDir: string;

    beforeEach(() => {
      repoDir = mkdtempSync(join(tmpdir(), 'gitbor-cm-ms-'));
      gitDir = join(repoDir, '.git');
      mkdirSync(gitDir, { recursive: true });
    });
    afterEach(() => {
      try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('clean state → kind=none, inProgress=false', async () => {
      const exec = vi.fn(async (args: string[]): Promise<GitExecResult> => {
        if (args.join(' ') === 'diff --name-only --diff-filter=U') {
          return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
        }
        return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
      });
      const git = { exec, getCwd: vi.fn(() => repoDir) } as MockGit;
      const cm = new ConflictManager(asGit(git));
      const ms = await cm.getMergeState();
      expect(ms.inProgress).toBe(false);
      expect(ms.kind).toBe('none');
    });

    it('unmerged-paths kind without MERGE_HEAD', async () => {
      const exec = vi.fn(async (args: string[]): Promise<GitExecResult> => {
        const key = args.join(' ');
        if (key === 'diff --name-only --diff-filter=U') {
          return { stdout: 'src/a.ts\n', stderr: '', exitCode: 0, duration: 1 };
        }
        if (key === 'rev-parse --abbrev-ref HEAD') {
          return { stdout: 'main\n', stderr: '', exitCode: 0, duration: 1 };
        }
        if (key === 'status --porcelain=v1') {
          return { stdout: 'UU src/a.ts\n', stderr: '', exitCode: 0, duration: 1 };
        }
        return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
      });
      const git = { exec, getCwd: vi.fn(() => repoDir) } as MockGit;
      const cm = new ConflictManager(asGit(git));
      const ms = await cm.getMergeState();
      expect(ms.inProgress).toBe(true);
      expect(ms.kind).toBe('unmerged-paths');
      expect(ms.sourceBranch).toBe(''); // unmerged-paths не имеет source
    });
  });
});
