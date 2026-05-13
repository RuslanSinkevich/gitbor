import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitExecOptions, GitExecResult } from '../../src/core/git/types';
import { makeFakeRegistry, type MockGit } from '../_mocks';

/**
 * Unit-тесты для дедупликации refreshGraph в StateManager.
 *
 * Проверяем главный инвариант Фикс 1: если `git log` stdout byte-to-byte
 * совпадает с предыдущим (тот же headHash + тот же лимит), — state.commits
 * и state.graphLayout сохраняют прежние ссылки. Это главная оптимизация
 * переключения между открытыми репо: renderer не переваливается на
 * пересчёт groupBranchPaths(15k).
 */

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/gitbor-test-user' },
}));

vi.mock('@core/state/GraphCache', () => ({
  loadGraphCache: vi.fn().mockResolvedValue(null),
  saveGraphCache: vi.fn().mockResolvedValue(undefined),
}));

function makeCommitLine(hash: string, parent: string, subject: string): string {
  // LOG_FORMAT = '%H\x00%P\x00%an\x00%ae\x00%at\x00%D\x00%s\x00%G?'
  return [hash, parent, 'Alice', 'a@example.com', '1700000000', '', subject, 'N'].join('\x00');
}

const REPO_STDOUT_A = [
  makeCommitLine('aaa1', '', 'c1'),
  makeCommitLine('aaa2', 'aaa1', 'c2'),
  makeCommitLine('aaa3', 'aaa2', 'c3'),
].join('\n') + '\n';

const REPO_STDOUT_B = [
  makeCommitLine('bbb1', '', 'other'),
  makeCommitLine('bbb2', 'bbb1', 'other2'),
].join('\n') + '\n';

/** Заводим scripted-mock GitExecutor с killAll/setCwd, как ждёт StateManager. */
function createMockGit(scripted: Map<string, string>): MockGit {
  return {
    exec: vi.fn(async (args: string[]): Promise<GitExecResult> => {
      const key = args.join(' ');
      if (key.startsWith('rev-parse HEAD')) {
        return { stdout: 'aaa3\n', stderr: '', exitCode: 0, duration: 1 };
      }
      if (key.startsWith('log ')) {
        return { stdout: REPO_STDOUT_A, stderr: '', exitCode: 0, duration: 1 };
      }
      return { stdout: scripted.get(key) ?? '', stderr: '', exitCode: 0, duration: 1 };
    }),
    setCwd: vi.fn(),
    getCwd: vi.fn().mockReturnValue('/repo'),
    killAll: vi.fn().mockReturnValue(0),
  };
}

describe('StateManager.refreshGraph dedup', () => {
  let StateManager: typeof import('@core/state/StateManager').StateManager;

  beforeEach(async () => {
    ({ StateManager } = await import('@core/state/StateManager'));
  });

  it('не пересоздаёт ссылки на commits/graphLayout при идентичном повторном refreshGraph', async () => {
    const git = createMockGit(new Map());
    const sm = new StateManager(makeFakeRegistry(git));
    sm.setRepoPath('/repo');

    await sm.refreshGraph(500);
    const firstCommits = sm.getState().commits;
    const firstLayout = sm.getState().graphLayout;

    expect(firstCommits.length).toBe(3);
    expect(firstLayout.nodes.length).toBe(3);

    await sm.refreshGraph(500);
    const secondCommits = sm.getState().commits;
    const secondLayout = sm.getState().graphLayout;

    // Главный инвариант: ссылки должны быть те же.
    expect(secondCommits).toBe(firstCommits);
    expect(secondLayout).toBe(firstLayout);
  });

  it('пересоздаёт массив если stdout изменился (реальный новый коммит)', async () => {
    let stdout = REPO_STDOUT_A;
    const git: MockGit = {
      exec: vi.fn(async (args: string[]): Promise<GitExecResult> => {
        const key = args.join(' ');
        if (key.startsWith('rev-parse HEAD')) {
          return { stdout: 'xxx\n', stderr: '', exitCode: 0, duration: 1 };
        }
        if (key.startsWith('log ')) {
          return { stdout, stderr: '', exitCode: 0, duration: 1 };
        }
        return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
      }),
      setCwd: vi.fn(),
      getCwd: vi.fn().mockReturnValue('/repo'),
      killAll: vi.fn().mockReturnValue(0),
    };
    const sm = new StateManager(makeFakeRegistry(git));
    sm.setRepoPath('/repo');
    await sm.refreshGraph(500);
    const firstCommits = sm.getState().commits;

    // Симулируем новый коммит сверху — меняется и stdout, и headHash.
    stdout = makeCommitLine('aaa4', 'aaa3', 'c4') + '\n' + REPO_STDOUT_A;
    git.exec = vi.fn(async (args: string[]): Promise<GitExecResult> => {
      const key = args.join(' ');
      if (key.startsWith('rev-parse HEAD')) {
        return { stdout: 'aaa4\n', stderr: '', exitCode: 0, duration: 1 };
      }
      if (key.startsWith('log ')) {
        return { stdout, stderr: '', exitCode: 0, duration: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
    });

    await sm.refreshGraph(500);
    const secondCommits = sm.getState().commits;

    expect(secondCommits).not.toBe(firstCommits);
    expect(secondCommits.length).toBe(4);
  });

  it('invalidateGraphCache форсит пересборку при следующем refreshGraph', async () => {
    const git = createMockGit(new Map());
    const sm = new StateManager(makeFakeRegistry(git));
    sm.setRepoPath('/repo');

    await sm.refreshGraph(500);
    const firstCommits = sm.getState().commits;

    sm.invalidateGraphCache();

    await sm.refreshGraph(500);
    const secondCommits = sm.getState().commits;

    // После invalidate ссылка должна поменяться даже при идентичном stdout.
    expect(secondCommits).not.toBe(firstCommits);
    expect(secondCommits.length).toBe(3);
  });

  it('refreshAll(closedPath) — no-op после notifyRepoClose, services не пересоздаются', async () => {
    const git = createMockGit(new Map());

    // Здесь нужны явные spy для acquire/release, поэтому собираем кастомный
    // registry вручную (а не через makeFakeRegistry). Это единственный кейс
    // во всём StateManager.test.ts, где спайны нужны для проверки релиза.
    const fakeServices = {
      repoPath: '/repo/x',
      git,
      queue: {
        enqueueRead: <T>(_l: string, op: () => Promise<T>) => op(),
        enqueueWrite: <T>(_l: string, op: () => Promise<T>) => op(),
        onStatusChange: () => () => {},
      },
      safety: {
        wrapDestructive: <T>(_n: string, _p: Record<string, string>, op: () => Promise<T>) => op(),
      },
    };

    const acquireSpy = vi.fn(() => fakeServices);
    const releaseSpy = vi.fn();
    const registry = {
      has: () => true,
      bootstrap: () => acquireSpy(),
      acquire: acquireSpy,
      get: acquireSpy,
      release: releaseSpy,
      disposeAll: () => {},
      onAnyOperationStatusChange: () => () => {},
      size: () => 1,
    };

    const sm = new StateManager(registry as unknown as import('../../src/core/services/RepoServicesRegistry').RepoServicesRegistry);
    sm.setRepoPath('/repo/x'); // добавляет в openRepos
    await sm.refreshAll();

    // Имитируем закрытие: активное репо переключается на другое (или сброс),
    // путь вылетает из openRepos, slice удаляется, services release'нуты.
    sm.setRepoPath('/repo/other');
    sm.setOpenRepos([{ name: 'other', path: '/repo/other' }]);
    sm.notifyRepoClose('/repo/x');
    expect(releaseSpy).toHaveBeenCalledWith('/repo/x');

    const execCallsBefore = git.exec.mock.calls.length;
    const acquireCallsBefore = acquireSpy.mock.calls.length;

    // Любой отложенный refresh на закрытый путь не должен ни exec'ить git,
    // ни вызывать registry.acquire (иначе в map снова появятся services).
    await sm.refreshAll('/repo/x');
    await sm.refreshStatusAndNotify('/repo/x');
    await sm.refreshGraph(500, '/repo/x');
    expect(git.exec).toHaveBeenCalledTimes(execCallsBefore);
    expect(acquireSpy.mock.calls.length).toBe(acquireCallsBefore);
  });

  it('работает на двух репо с разными stdout подряд (после инвалидации)', async () => {
    const git: MockGit = {
      exec: vi.fn(async (args: string[]): Promise<GitExecResult> => {
        const key = args.join(' ');
        if (key.startsWith('rev-parse HEAD')) return { stdout: 'aaa3\n', stderr: '', exitCode: 0, duration: 1 };
        if (key.startsWith('log ')) return { stdout: REPO_STDOUT_A, stderr: '', exitCode: 0, duration: 1 };
        return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
      }),
      setCwd: vi.fn(),
      getCwd: vi.fn().mockReturnValue('/repo'),
      killAll: vi.fn().mockReturnValue(0),
    };
    const sm = new StateManager(makeFakeRegistry(git));
    sm.setRepoPath('/repo');

    await sm.refreshGraph(500);
    expect(sm.getState().commits).toHaveLength(3);

    sm.invalidateGraphCache();

    git.exec = vi.fn(async (args: string[]): Promise<GitExecResult> => {
      const key = args.join(' ');
      if (key.startsWith('rev-parse HEAD')) return { stdout: 'bbb2\n', stderr: '', exitCode: 0, duration: 1 };
      if (key.startsWith('log ')) return { stdout: REPO_STDOUT_B, stderr: '', exitCode: 0, duration: 1 };
      return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
    });

    await sm.refreshGraph(500);
    expect(sm.getState().commits).toHaveLength(2);
    expect(sm.getState().commits[0].hash).toBe('bbb1');
  });
});

describe('StateManager.refreshStatus untracked-files mode', () => {
  let StateManager: typeof import('@core/state/StateManager').StateManager;

  beforeEach(async () => {
    ({ StateManager } = await import('@core/state/StateManager'));
  });

  it('использует --untracked-files=all для нормальных репо (не опасный путь)', async () => {
    const git: MockGit = {
      exec: vi.fn(async (): Promise<GitExecResult> => ({ stdout: '', stderr: '', exitCode: 0, duration: 1 })),
      setCwd: vi.fn(),
      getCwd: vi.fn().mockReturnValue('/projects/normal-repo'),
      killAll: vi.fn().mockReturnValue(0),
    };
    const sm = new StateManager(makeFakeRegistry(git));
    sm.setRepoPath('/projects/normal-repo');

    await sm.refreshStatus('/projects/normal-repo');

    type ExecCall = [string[], GitExecOptions?];
    const statusCalls = (git.exec.mock.calls as ExecCall[]).filter(c => c[0]?.[0] === 'status');
    expect(statusCalls.length).toBeGreaterThan(0);
    expect(statusCalls[0][0]).toContain('--untracked-files=all');
  });

  it('использует --untracked-files=normal для опасных корней (домашка/корень диска)', async () => {
    const git: MockGit = {
      exec: vi.fn(async (): Promise<GitExecResult> => ({ stdout: '', stderr: '', exitCode: 0, duration: 1 })),
      setCwd: vi.fn(),
      getCwd: vi.fn().mockReturnValue('/'),
      killAll: vi.fn().mockReturnValue(0),
    };
    const sm = new StateManager(makeFakeRegistry(git));
    // На POSIX `/` — опасный путь (driveRoot). На Windows — `C:\`.
    const dangerousPath = process.platform === 'win32' ? 'C:\\' : '/';
    sm.setRepoPath(dangerousPath);

    await sm.refreshStatus(dangerousPath);

    type ExecCall = [string[], GitExecOptions?];
    const statusCalls = (git.exec.mock.calls as ExecCall[]).filter(c => c[0]?.[0] === 'status');
    expect(statusCalls.length).toBeGreaterThan(0);
    expect(statusCalls[0][0]).toContain('--untracked-files=normal');
  });
});
