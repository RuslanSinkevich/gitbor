import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { GitExecResult } from '../../src/core/git/types';

/**
 * Unit-тесты SafetyNet.wrapDestructive + rollback.
 *
 * Идея: GitExecutor моком, .git папка в tmp — OperationJournal пишет туда
 * настоящий JSON через AtomicWrite. Так покрываем и happy-path, и кейсы
 * с unstaged, и autoRollback при падении operation.
 */

interface ScriptedExec {
  exec: ReturnType<typeof vi.fn>;
  getCwd: () => string;
  setCwd?: (cwd: string) => void;
  killAll?: () => Promise<void>;
}

let repoDir: string;
let gitDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'gitbor-safetynet-'));
  gitDir = join(repoDir, '.git');
  mkdirSync(gitDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(repoDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

interface MockGitOptions {
  headHash?: string;
  branch?: string;
  uncommitted?: string;
  stashPushExit?: number;
  stashHash?: string;
  operationOnExec?: (args: string[]) => void;
}

function makeMockGit(opts: MockGitOptions = {}): ScriptedExec {
  const {
    headHash = 'abc123head',
    branch = 'main',
    uncommitted = '',
    stashPushExit = 0,
    stashHash = 'stashhash',
  } = opts;

  const exec = vi.fn(async (args: string[]): Promise<GitExecResult> => {
    opts.operationOnExec?.(args);
    const key = args.join(' ');
    if (key === 'rev-parse HEAD') {
      return { stdout: headHash + '\n', stderr: '', exitCode: 0, duration: 1 };
    }
    if (key === 'rev-parse --abbrev-ref HEAD') {
      return { stdout: branch + '\n', stderr: '', exitCode: 0, duration: 1 };
    }
    if (key === 'status --porcelain') {
      return { stdout: uncommitted, stderr: '', exitCode: 0, duration: 1 };
    }
    if (key.startsWith('stash push')) {
      return { stdout: '', stderr: stashPushExit === 0 ? '' : 'stash failed', exitCode: stashPushExit, duration: 1 };
    }
    if (key === 'rev-parse stash@{0}') {
      return { stdout: stashHash + '\n', stderr: '', exitCode: 0, duration: 1 };
    }
    if (key === 'stash pop' || key.startsWith('stash apply')) {
      return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
    }
    if (key.startsWith('reset --hard')) {
      return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
    }
    if (key.startsWith('checkout')) {
      return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
    }
    return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
  });

  return {
    exec,
    getCwd: () => repoDir,
  };
}

describe('SafetyNet.wrapDestructive', () => {
  it('happy path: clean tree, operation succeeds → no stash, success=true', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    const operation = vi.fn(async () => 'data');
    const result = await sn.wrapDestructive('test-op', { foo: 'bar' }, operation);

    expect(result.success).toBe(true);
    expect(result.data).toBe('data');
    expect(result.rollbackAvailable).toBe(true);
    expect(operation).toHaveBeenCalledOnce();
    // не должно быть stash push при пустом status
    const stashCalls = git.exec.mock.calls.filter(([args]: [string[]]) => args[0] === 'stash' && args[1] === 'push');
    expect(stashCalls).toHaveLength(0);
  });

  it('with uncommitted: creates auto-stash with GitBor prefix and op name', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: ' M src/index.ts\n' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('rebase', { target: 'main' }, async () => 'ok');

    const stashCall = git.exec.mock.calls.find(([args]: [string[]]) => args[0] === 'stash' && args[1] === 'push');
    expect(stashCall).toBeDefined();
    const msgIdx = stashCall![0].indexOf('-m');
    const stashMsg = stashCall![0][msgIdx + 1] as string;
    expect(stashMsg).toContain('[GitBor auto-stash]');
    expect(stashMsg).toContain('rebase');
    expect(stashMsg).toContain('main');
  });

  it('with uncommitted: after success calls stash pop to restore changes', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: ' M file\n' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => 'ok');

    const popCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'stash' && args[1] === 'pop',
    );
    expect(popCall).toBeDefined();
  });

  it('skips auto-stash when autoStash=false even with uncommitted', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: ' M f\n' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => 'ok', { autoStash: false });

    const stashCall = git.exec.mock.calls.find(([args]: [string[]]) => args[0] === 'stash' && args[1] === 'push');
    expect(stashCall).toBeUndefined();
  });

  it('returns success=false and rollbackAvailable=false when stash push fails', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: ' M f\n', stashPushExit: 1 });
    const sn = new SafetyNet(git as never);

    const operation = vi.fn();
    const result = await sn.wrapDestructive('op', {}, operation);

    expect(result.success).toBe(false);
    expect(result.rollbackAvailable).toBe(false);
    expect(operation).not.toHaveBeenCalled();
  });

  it('on operation error: auto-rollback resets to saved HEAD by default', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ headHash: 'savedhead' });
    const sn = new SafetyNet(git as never);

    const result = await sn.wrapDestructive('op', {}, async () => { throw new Error('boom'); });

    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
    const resetCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'reset' && args[1] === '--hard',
    );
    expect(resetCall).toBeDefined();
    expect(resetCall![0]).toContain('savedhead');
  });

  it('on operation error with autoRollback=false: does NOT reset', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => { throw new Error('x'); }, { autoRollback: false });

    const resetCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'reset' && args[1] === '--hard',
    );
    expect(resetCall).toBeUndefined();
  });

  it('on operation error: rollback also restores stash if auto-stash was created', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: ' M f\n' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => { throw new Error('x'); });

    const popCalls = git.exec.mock.calls.filter(([args]: [string[]]) =>
      args[0] === 'stash' && args[1] === 'pop',
    );
    expect(popCalls.length).toBeGreaterThan(0);
  });

  it('detached HEAD (branch=HEAD): does NOT call checkout on rollback', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ branch: 'HEAD' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => { throw new Error('x'); });

    const checkoutCall = git.exec.mock.calls.find(([args]: [string[]]) => args[0] === 'checkout');
    expect(checkoutCall).toBeUndefined();
  });

  it('non-HEAD branch: rollback calls checkout to restore branch', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ branch: 'feature/x' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => { throw new Error('x'); });

    const checkoutCall = git.exec.mock.calls.find(([args]: [string[]]) => args[0] === 'checkout');
    expect(checkoutCall).toBeDefined();
    expect(checkoutCall![0]).toEqual(['checkout', 'feature/x']);
  });

  it('does not stash when status is whitespace-only (treated as clean)', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: '   \n  \n' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => 'ok');
    const stashPush = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'stash' && args[1] === 'push',
    );
    expect(stashPush).toBeUndefined();
  });

  it('returns rollbackAvailable=true on success (journal entry exists)', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    const r = await sn.wrapDestructive('op', {}, async () => 'ok');
    expect(r.rollbackAvailable).toBe(true);
  });

  it('non-Error throw becomes string in result.error', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    const r = await sn.wrapDestructive('op', {}, async () => {
      throw 'plain-string-error';
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('plain-string-error');
  });
});

describe('SafetyNet.rollback (via journal)', () => {
  it('throws when journal entry id not found', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    await expect(sn.rollback('op_unknown_id')).rejects.toThrow(/not found/);
  });

  it('replays saved headHash + branch from journal entry', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ headHash: 'rollbackhead', branch: 'main' });
    const sn = new SafetyNet(git as never);

    // создаём запись через wrapDestructive (sucess path)
    await sn.wrapDestructive('op', {}, async () => 'ok');

    // читаем journal, чтобы достать id
    const { OperationJournal } = await import('../../src/core/safety/OperationJournal');
    const journal = new OperationJournal(gitDir);
    const all = await journal.getAll();
    expect(all.length).toBeGreaterThan(0);
    const id = all[0].id;

    git.exec.mockClear();
    await sn.rollback(id);

    const resetCall = git.exec.mock.calls.find(([args]: [string[]]) => args[0] === 'reset');
    expect(resetCall).toBeDefined();
    expect(resetCall![0]).toEqual(['reset', '--hard', 'rollbackhead']);
    const checkoutCall = git.exec.mock.calls.find(([args]: [string[]]) => args[0] === 'checkout');
    expect(checkoutCall).toBeDefined();
    expect(checkoutCall![0]).toEqual(['checkout', 'main']);
  });
});

describe('SafetyNet.restoreAutoStash', () => {
  it('calls git stash apply with provided hash', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    await sn.restoreAutoStash('myhash');

    const applyCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'stash' && args[1] === 'apply',
    );
    expect(applyCall).toBeDefined();
    expect(applyCall![0]).toEqual(['stash', 'apply', 'myhash']);
  });
});
