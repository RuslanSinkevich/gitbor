import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Тестируем парсинг по платформам без реального forking процессов:
 * mock `child_process.execFile` через `util.promisify` и подменяем
 * stdout под Windows powershell / posix ps.
 */

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../../src/core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { execFile } from 'child_process';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function mockSuccess(stdout: string) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
    const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
    callback(null, stdout, '');
  });
}

function mockFailure(err: Error) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
    const callback = cb as (err: Error | null, stdout: string, stderr: string) => void;
    callback(err, '', '');
  });
}

describe('GitProcessDetector.findGitProcesses (Windows)', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('parses Get-CimInstance JSON array', async () => {
    mockSuccess(JSON.stringify([
      { ProcessId: 1234, CommandLine: 'git commit -m foo', ExecutablePath: 'C:\\git\\git.exe' },
      { ProcessId: 5678, CommandLine: 'git status', ExecutablePath: 'C:\\git\\git.exe' },
    ]));

    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses(undefined, { platform: 'win32' });
    expect(procs).toHaveLength(2);
    expect(procs[0]).toMatchObject({ pid: 1234, command: 'git commit -m foo' });
    expect(procs[1]).toMatchObject({ pid: 5678, command: 'git status' });
  });

  it('parses single object (PowerShell collapses 1-item to object)', async () => {
    mockSuccess(JSON.stringify({ ProcessId: 9999, CommandLine: 'git add .', ExecutablePath: 'git.exe' }));

    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses(undefined, { platform: 'win32' });
    expect(procs).toHaveLength(1);
    expect(procs[0].pid).toBe(9999);
  });

  it('returns empty on empty stdout', async () => {
    mockSuccess('');
    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses(undefined, { platform: 'win32' });
    expect(procs).toEqual([]);
  });

  it('returns empty on malformed JSON', async () => {
    mockSuccess('{not json}');
    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses(undefined, { platform: 'win32' });
    expect(procs).toEqual([]);
  });

  it('skips entries with non-numeric pid', async () => {
    mockSuccess(JSON.stringify([{ ProcessId: 'NaN', CommandLine: 'git status', ExecutablePath: '' }]));
    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses(undefined, { platform: 'win32' });
    expect(procs).toEqual([]);
  });

  it('filters by repoPath via CommandLine substring', async () => {
    mockSuccess(JSON.stringify([
      { ProcessId: 1, CommandLine: 'git -C C:/repo-a/src commit', ExecutablePath: '' },
      { ProcessId: 2, CommandLine: 'git -C C:/repo-b status', ExecutablePath: '' },
    ]));
    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses('C:/repo-a', { platform: 'win32' });
    expect(procs).toHaveLength(1);
    expect(procs[0].pid).toBe(1);
  });

  it('returns empty array on execFile failure', async () => {
    mockFailure(new Error('powershell blocked by policy'));
    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses(undefined, { platform: 'win32' });
    expect(procs).toEqual([]);
  });
});

describe('GitProcessDetector.findGitProcesses (POSIX)', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('parses ps output and filters non-git', async () => {
    mockSuccess(
      ' 1234 git commit -m foo\n' +
      ' 5678 git status\n' +
      ' 9999 vim /tmp/git.swp\n' +
      ' 1111 /usr/local/bin/git push origin main\n'
    );

    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses(undefined, { platform: 'linux' });
    expect(procs).toHaveLength(3);
    expect(procs.map(p => p.pid).sort()).toEqual([1111, 1234, 5678]);
  });

  it('filters by repoPath substring in command', async () => {
    mockSuccess(
      ' 100 git -C /home/me/repo-a commit\n' +
      ' 200 git -C /home/me/repo-b commit\n'
    );

    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses('/home/me/repo-a', { platform: 'linux' });
    expect(procs).toHaveLength(1);
    expect(procs[0].pid).toBe(100);
  });

  it('returns empty on ps failure (best-effort)', async () => {
    mockFailure(new Error('ps not found'));
    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses(undefined, { platform: 'darwin' });
    expect(procs).toEqual([]);
  });

  it('ignores lines without pid prefix', async () => {
    mockSuccess('garbage line\n  another\n');
    const { findGitProcesses } = await import('../../src/core/safety/GitProcessDetector');
    const procs = await findGitProcesses(undefined, { platform: 'linux' });
    expect(procs).toEqual([]);
  });
});
