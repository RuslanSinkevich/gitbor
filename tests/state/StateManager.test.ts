import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  app: { getPath: () => '/tmp/skyfork-test-user' },
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

function createMockGit(scripted: Map<string, string>) {
  return {
    exec: vi.fn(async (args: string[]) => {
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

/**
 * Минимальный фейковый registry для тестов: всегда возвращает один и тот же
 * git (плюс заглушки `OperationQueue`/`SafetyNet`). Имитирует реальный API
 * `RepoServicesRegistry`, чтобы StateManager работал без изменения тестов.
 */
function fakeRegistry(git: any) {
  const services = {
    repoPath: '/repo',
    git,
    queue: { enqueueRead: (_l: string, op: any) => op(), enqueueWrite: (_l: string, op: any) => op(), onStatusChange: () => () => {} },
    safety: { wrapDestructive: (_n: string, _p: any, op: any) => op() },
  };
  return {
    has: () => true,
    bootstrap: () => services,
    acquire: () => services,
    get: () => services,
    release: () => {},
    disposeAll: () => {},
    onAnyOperationStatusChange: () => () => {},
    size: () => 1,
  } as any;
}


describe('StateManager.refreshGraph dedup', () => {
  let StateManager: typeof import('@core/state/StateManager').StateManager;

  beforeEach(async () => {
    ({ StateManager } = await import('@core/state/StateManager'));
  });

  it('не пересоздаёт ссылки на commits/graphLayout при идентичном повторном refreshGraph', async () => {
    const git = createMockGit(new Map());
    const sm = new StateManager(fakeRegistry(git));

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
    const git = {
      exec: vi.fn(async (args: string[]) => {
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
    };

    (git as any).killAll = vi.fn().mockReturnValue(0);
    const sm = new StateManager(fakeRegistry(git));
    await sm.refreshGraph(500);
    const firstCommits = sm.getState().commits;

    // Симулируем новый коммит сверху — меняется и stdout, и headHash.
    stdout = makeCommitLine('aaa4', 'aaa3', 'c4') + '\n' + REPO_STDOUT_A;
    git.exec = vi.fn(async (args: string[]) => {
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
    const sm = new StateManager(fakeRegistry(git));

    await sm.refreshGraph(500);
    const firstCommits = sm.getState().commits;

    sm.invalidateGraphCache();

    await sm.refreshGraph(500);
    const secondCommits = sm.getState().commits;

    // После invalidate ссылка должна поменяться даже при идентичном stdout.
    expect(secondCommits).not.toBe(firstCommits);
    expect(secondCommits.length).toBe(3);
  });

  it('работает на двух репо с разными stdout подряд (после инвалидации)', async () => {
    const git: any = {
      exec: vi.fn(async (args: string[]) => {
        const key = args.join(' ');
        if (key.startsWith('rev-parse HEAD')) return { stdout: 'aaa3\n', stderr: '', exitCode: 0, duration: 1 };
        if (key.startsWith('log ')) return { stdout: REPO_STDOUT_A, stderr: '', exitCode: 0, duration: 1 };
        return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
      }),
      setCwd: vi.fn(),
      getCwd: vi.fn().mockReturnValue('/repo'),
      killAll: vi.fn().mockReturnValue(0),
    };
    const sm = new StateManager(fakeRegistry(git));

    await sm.refreshGraph(500);
    expect(sm.getState().commits).toHaveLength(3);

    sm.invalidateGraphCache();

    git.exec = vi.fn(async (args: string[]) => {
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
