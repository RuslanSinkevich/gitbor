import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { GitExecResult } from '../../src/core/git/types';

/**
 * Unit-тесты SafetyNet.wrapDestructive под НОВЫЙ контракт:
 *   - rollback по умолчанию НЕ происходит (юзер сам через UI решает);
 *   - конфликты merge возвращаются как success:false errorClass='conflict',
 *     без reset;
 *   - транзитные ошибки (lock_held / network / auth) → success:false с
 *     `suggestedActions`;
 *   - legacy-флаг `legacyAutoRollback=true` восстанавливает старое
 *     поведение (reset --hard + stash pop) для совместимости старых тестов.
 *   - guard: при наличии UU пред stash push возвращаем unmerged_paths.
 */

vi.mock('../../src/core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

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
  try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

interface MockGitOptions {
  headHash?: string;
  branch?: string;
  uncommitted?: string;
  stashPushExit?: number;
  stashPushStderr?: string;
  stashHash?: string;
  uuFiles?: string[];
  /** Stash apply exit. */
  stashApplyExit?: number;
  /** Уже существующий стэш пользователя (вершина refs/stash до операции). */
  preexistingStash?: string;
  /** stash push вышел с 0, но ничего не отложил («No local changes to save»). */
  stashPushNoop?: boolean;
}

function makeMockGit(opts: MockGitOptions = {}): ScriptedExec {
  const {
    headHash = 'abc123head',
    branch = 'main',
    uncommitted = '',
    stashPushExit = 0,
    stashPushStderr = '',
    stashHash = 'stashhash',
    uuFiles = [],
    stashApplyExit = 0,
    preexistingStash = '',
    stashPushNoop = false,
  } = opts;
  let stashCreated = false;

  const exec = vi.fn(async (args: string[]): Promise<GitExecResult> => {
    const key = args.join(' ');
    if (key === 'rev-parse HEAD') {
      return { stdout: headHash + '\n', stderr: '', exitCode: 0, duration: 1 };
    }
    if (key === 'rev-parse --abbrev-ref HEAD') {
      return { stdout: branch + '\n', stderr: '', exitCode: 0, duration: 1 };
    }
    if (key === 'diff --name-only --diff-filter=U') {
      return { stdout: uuFiles.join('\n'), stderr: '', exitCode: 0, duration: 1 };
    }
    if (key === 'status --porcelain') {
      return { stdout: uncommitted, stderr: '', exitCode: 0, duration: 1 };
    }
    if (key.startsWith('stash push')) {
      if (stashPushExit === 0 && !stashPushNoop) stashCreated = true;
      return { stdout: '', stderr: stashPushStderr, exitCode: stashPushExit, duration: 1 };
    }
    if (key === 'rev-parse -q --verify refs/stash') {
      // До push — пользовательский стэш (или пусто), после — наш auto-stash.
      const tip = stashCreated ? stashHash : preexistingStash;
      return { stdout: tip ? tip + '\n' : '', stderr: '', exitCode: tip ? 0 : 1, duration: 1 };
    }
    if (key.startsWith('stash apply')) {
      return { stdout: '', stderr: stashApplyExit === 0 ? '' : 'apply fail', exitCode: stashApplyExit, duration: 1 };
    }
    if (key.startsWith('stash list')) {
      return { stdout: `stash@{0}\x00${stashHash}\n`, stderr: '', exitCode: 0, duration: 1 };
    }
    if (key.startsWith('stash drop') || key === 'stash pop') {
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

describe('SafetyNet.wrapDestructive (new contract)', () => {
  it('happy path: clean tree, operation succeeds → no stash, success=true', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    const operation = vi.fn(async () => 'data');
    const result = await sn.wrapDestructive('test-op', { foo: 'bar' }, operation);

    expect(result.success).toBe(true);
    expect(result.data).toBe('data');
    expect(operation).toHaveBeenCalledOnce();
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

  it('merge with conflicts: does not restore auto-stash while merge session active', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const { writeFileSync } = await import('fs');
    const git = makeMockGit({ uncommitted: ' M file\n' });
    writeFileSync(join(gitDir, 'MERGE_HEAD'), 'deadbeef\n');
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive(
      'merge',
      { source: 'feature/x' },
      async () => ({ success: false, conflicts: ['src/a.ts'] }),
    );

    const applyCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'stash' && args[1] === 'apply',
    );
    expect(applyCall).toBeUndefined();
  });

  it('with uncommitted: after success calls stash apply then drop (NOT pop)', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: ' M file\n' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => 'ok');

    const applyCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'stash' && args[1] === 'apply',
    );
    expect(applyCall).toBeDefined();
    const dropCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'stash' && args[1] === 'drop',
    );
    expect(dropCall).toBeDefined();
    // drop только по stash@{n} — hash git не принимает.
    expect(dropCall![0]).toEqual(['stash', 'drop', 'stash@{0}']);
    // pop НЕ должен использоваться — он был источником "потерянных" данных.
    const popCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'stash' && args[1] === 'pop',
    );
    expect(popCall).toBeUndefined();
  });

  it('stash apply failed after success: stash remains (no drop), warn logged', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: ' M f\n', stashApplyExit: 1 });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => 'ok');

    const dropCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'stash' && args[1] === 'drop',
    );
    expect(dropCall).toBeUndefined();
  });

  it('skips auto-stash when autoStash=false even with uncommitted', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: ' M f\n' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => 'ok', { autoStash: false });

    const stashCall = git.exec.mock.calls.find(([args]: [string[]]) => args[0] === 'stash' && args[1] === 'push');
    expect(stashCall).toBeUndefined();
  });

  it('stash push fails → success=false, errorClass from classifier, no operation call', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({
      uncommitted: ' M f\n',
      stashPushExit: 1,
      stashPushStderr: "fatal: Unable to create '.git/index.lock': File exists.",
    });
    const sn = new SafetyNet(git as never);

    const operation = vi.fn();
    const result = await sn.wrapDestructive('op', {}, operation);

    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('lock_held');
    expect(operation).not.toHaveBeenCalled();
  });

  it('UU paths in index → blocks stash push, returns unmerged_paths', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uuFiles: ['src/a.ts'] });
    const sn = new SafetyNet(git as never);

    const operation = vi.fn();
    const result = await sn.wrapDestructive('op', {}, operation);

    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('unmerged_paths');
    expect(operation).not.toHaveBeenCalled();
    const stashCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'stash' && args[1] === 'push',
    );
    expect(stashCall).toBeUndefined();
  });

  it('operation throws GitError with conflict stderr → errorClass=conflict, NO rollback', async () => {
    const { GitError: ImportedGitError } = await import('../../src/core/git/GitExecutor');
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    const result = await sn.wrapDestructive('merge', {}, async () => {
      throw new ImportedGitError(
        'merge failed',
        'merge',
        1,
        'CONFLICT (content): Merge conflict in src/a.ts\nAutomatic merge failed; fix conflicts and then commit the result.',
      );
    });

    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('conflict');
    const resetCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'reset' && args[1] === '--hard',
    );
    expect(resetCall).toBeUndefined();
    expect(result.suggestedActions?.find(a => a.kind === 'continue_merge')).toBeDefined();
    expect(result.suggestedActions?.find(a => a.kind === 'abort_merge')).toBeDefined();
  });

  it('cherry-pick conflict → continue_cherry_pick (не continue_merge)', async () => {
    const { GitError: ImportedGitError } = await import('../../src/core/git/GitExecutor');
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    const result = await sn.wrapDestructive('cherry-pick', {}, async () => {
      throw new ImportedGitError(
        'cherry-pick failed',
        'cherry-pick',
        1,
        'error: could not apply abc1234... CONFLICTing\nCONFLICT (content): Merge conflict in src/a.ts',
      );
    });

    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('conflict');
    expect(result.suggestedActions?.find(a => a.kind === 'continue_cherry_pick')).toBeDefined();
    expect(result.suggestedActions?.find(a => a.kind === 'continue_merge')).toBeUndefined();
    expect(result.suggestedActions?.find(a => a.kind === 'abort_merge')).toBeDefined();
  });

  it('operation throws lock_held stderr → no rollback, suggestedActions includes remove_lock+retry', async () => {
    const { GitError: ImportedGitError } = await import('../../src/core/git/GitExecutor');
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    const result = await sn.wrapDestructive('merge', {}, async () => {
      throw new ImportedGitError(
        'failed',
        'merge',
        1,
        "fatal: Unable to create '/.git/index.lock': File exists.",
      );
    });

    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('lock_held');
    const resetCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'reset' && args[1] === '--hard',
    );
    expect(resetCall).toBeUndefined();
    expect(result.suggestedActions?.find(a => a.kind === 'remove_lock')).toBeDefined();
    expect(result.suggestedActions?.find(a => a.kind === 'retry')).toBeDefined();
  });

  it('operation throws network stderr → suggestedActions includes retry', async () => {
    const { GitError: ImportedGitError } = await import('../../src/core/git/GitExecutor');
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    const result = await sn.wrapDestructive('fetch', {}, async () => {
      throw new ImportedGitError('failed', 'fetch', 1, 'fatal: unable to access ...: Could not resolve host: github.com');
    });

    expect(result.errorClass).toBe('network');
    expect(result.suggestedActions?.find(a => a.kind === 'retry')).toBeDefined();
  });

  it('legacyAutoRollback=true: resets to saved HEAD on error', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ headHash: 'savedhead' });
    const sn = new SafetyNet(git as never);

    const result = await sn.wrapDestructive(
      'op', {}, async () => { throw new Error('boom'); },
      { legacyAutoRollback: true },
    );

    expect(result.success).toBe(false);
    const resetCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'reset' && args[1] === '--hard',
    );
    expect(resetCall).toBeDefined();
    expect(resetCall![0]).toContain('savedhead');
  });

  it('legacy alias autoRollback=true maps to legacyAutoRollback', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ headHash: 'savedhead2' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive(
      'op', {}, async () => { throw new Error('boom'); },
      { autoRollback: true },
    );

    const resetCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'reset' && args[1] === '--hard',
    );
    expect(resetCall).toBeDefined();
  });

  it('default: no rollback on generic Error', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('op', {}, async () => { throw new Error('x'); });

    const resetCall = git.exec.mock.calls.find(([args]: [string[]]) =>
      args[0] === 'reset' && args[1] === '--hard',
    );
    expect(resetCall).toBeUndefined();
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

  it('returns journalEntryId on success and failure', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    const ok = await sn.wrapDestructive('op', {}, async () => 'ok');
    expect(ok.journalEntryId).toBeTruthy();

    const failed = await sn.wrapDestructive('op', {}, async () => { throw new Error('x'); });
    expect(failed.journalEntryId).toBeTruthy();
  });

  it('savedState filled on conflict (UI may need autoStashHash)', async () => {
    const { GitError: ImportedGitError } = await import('../../src/core/git/GitExecutor');
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: ' M f\n', headHash: 'h0' });
    const sn = new SafetyNet(git as never);

    const r = await sn.wrapDestructive('merge', {}, async () => {
      throw new ImportedGitError('x', 'merge', 1, 'CONFLICT (content): foo');
    });

    expect(r.savedState?.headHash).toBe('h0');
    expect(r.savedState?.autoStashHash).toBeDefined();
    expect(r.suggestedActions?.find(a => a.kind === 'apply_stash_only')).toBeDefined();
    expect(r.suggestedActions?.find(a => a.kind === 'drop_stash')).toBeDefined();
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

  it('on success: rollbackAvailable is true', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    const r = await sn.wrapDestructive('op', {}, async () => 'ok');
    expect(r.rollbackAvailable).toBe(true);
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

    await sn.wrapDestructive('op', {}, async () => 'ok');

    const { OperationJournal } = await import('../../src/core/safety/OperationJournal');
    const journal = new OperationJournal(gitDir);
    const all = await journal.getAll();
    expect(all.length).toBeGreaterThan(0);
    const id = all[0].id;

    git.exec.mockClear();
    await sn.rollback(id);

    const calls = git.exec.mock.calls.map(([args]: [string[]]) => args);
    const resetIdx = calls.findIndex(a => a[0] === 'reset');
    const checkoutIdx = calls.findIndex(a => a[0] === 'checkout');
    expect(calls[resetIdx]).toEqual(['reset', '--hard', 'rollbackhead']);
    expect(calls[checkoutIdx]).toEqual(['checkout', '-f', 'main']);
    // checkout ДО reset — иначе reset сдвинул бы ветку, на которую успела
    // переключиться операция.
    expect(checkoutIdx).toBeLessThan(resetIdx);
  });

  it('throws when rollback reset fails instead of reporting success', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ headHash: 'h1' });
    const sn = new SafetyNet(git as never);
    await sn.wrapDestructive('op', {}, async () => 'ok');
    const { OperationJournal } = await import('../../src/core/safety/OperationJournal');
    const id = (await new OperationJournal(gitDir).getAll())[0].id;

    const base = git.exec.getMockImplementation()!;
    git.exec.mockImplementation(async (args: string[]) =>
      args[0] === 'reset'
        ? { stdout: '', stderr: 'fatal: boom', exitCode: 128, duration: 1 }
        : base(args));
    await expect(sn.rollback(id)).rejects.toThrow(/reset failed/i);
  });
});

describe('SafetyNet auto-stash: чужой стэш не трогаем', () => {
  it('stash push «нечего откладывать» → user stash не применяется и не удаляется', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({
      uncommitted: ' M submodule\n',
      preexistingStash: 'userstash',
      stashPushNoop: true,
    });
    const sn = new SafetyNet(git as never);

    const result = await sn.wrapDestructive('checkout', {}, async () => 'ok');

    expect(result.success).toBe(true);
    const touched = git.exec.mock.calls.some(([args]: [string[]]) =>
      args[0] === 'stash' && (args[1] === 'apply' || args[1] === 'drop'));
    expect(touched).toBe(false);
  });

  it('новый auto-stash после операции применяется и удаляется', async () => {
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const git = makeMockGit({ uncommitted: ' M a.ts\n', preexistingStash: 'userstash', stashHash: 'autostash' });
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('checkout', {}, async () => 'ok');

    expect(git.exec).toHaveBeenCalledWith(['stash', 'apply', 'autostash']);
  });
});

describe('SafetyNet → OperationJournal integration', () => {
  it('on failure: writes errorClass into journal entry', async () => {
    const { GitError: ImportedGitError } = await import('../../src/core/git/GitExecutor');
    const { SafetyNet } = await import('../../src/core/safety/SafetyNet');
    const { OperationJournal } = await import('../../src/core/safety/OperationJournal');
    const git = makeMockGit();
    const sn = new SafetyNet(git as never);

    await sn.wrapDestructive('merge', {}, async () => {
      throw new ImportedGitError('merge failed', 'merge', 1, "fatal: Unable to create '/.git/index.lock': File exists.");
    });

    const journal = new OperationJournal(gitDir);
    const all = await journal.getAll();
    const failed = all.find(e => e.status === 'failed');
    expect(failed).toBeDefined();
    expect(failed!.errorClass).toBe('lock_held');
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
