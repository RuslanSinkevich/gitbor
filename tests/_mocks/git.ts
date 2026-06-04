import { vi, type Mock } from 'vitest';
import type { GitExecutor } from '../../src/core/git/GitExecutor';
import type { GitExecResult } from '../../src/core/git/types';

/**
 * Узкий тип «git-исполнителя» для тестов: ровно те методы реальных тестов
 * касаются на mock'е. Если очередному кейсу понадобится ещё что-то — добавь
 * именно тот метод сюда, а не размазывай Partial<GitExecutor>.
 */
export type MockGitExec = Mock<GitExecutor['exec']>;
export type MockGitExecBuffer = Mock<GitExecutor['execBuffer']>;

export interface MockGit {
  exec: MockGitExec;
  execBuffer: MockGitExecBuffer;
  getCwd: Mock<() => string>;
  setCwd?: Mock<(cwd: string) => void>;
  killAll?: Mock<() => number>;
}

export type GitExecResponse = Partial<GitExecResult>;

const DEFAULT_RESULT: GitExecResult = {
  stdout: '',
  stderr: '',
  exitCode: 0,
  duration: 5,
};

function makeBufferExec(execFn: MockGitExec): MockGitExecBuffer {
  // execBuffer возвращает тот же ответ, что и exec, только stdout/stderr
  // как Buffer'ы (utf-8). Для тестов этого достаточно — реальное
  // декодирование кодировок проверяется отдельным юнитом.
  return vi.fn(async (args: string[]) => {
    const r = await execFn(args);
    return {
      stdout: Buffer.from(r.stdout ?? '', 'utf-8'),
      stderr: Buffer.from(r.stderr ?? '', 'utf-8'),
      exitCode: r.exitCode ?? 0,
      duration: r.duration ?? 5,
    };
  }) as MockGitExecBuffer;
}

/**
 * Простейший mock GitExecutor: один и тот же ответ на любой вызов `exec`.
 * Используется в writeCommands/WorktreeManager/etc — где конкретные args
 * не важны, важен сам факт вызова.
 */
export function makeMockGit(overrides: GitExecResponse = {}): MockGit {
  const result: GitExecResult = { ...DEFAULT_RESULT, ...overrides };
  const exec: MockGitExec = vi.fn(async () => result);
  return {
    exec,
    execBuffer: makeBufferExec(exec),
    getCwd: vi.fn(() => '/repo'),
  };
}

/**
 * Mock GitExecutor со «скриптованными» ответами: ключ — подстрока в
 * `args.join(' ')`. Если ни один паттерн не подошёл — defaultResponse.
 * Используется в ConflictManager/RebaseManager/StateManager-тестах, где
 * разные git-команды должны отвечать по-разному.
 */
export function makeScriptedGit(
  responses: Record<string, GitExecResponse> = {},
  defaultResponse: GitExecResponse = {},
): MockGit {
  const def: GitExecResult = { ...DEFAULT_RESULT, ...defaultResponse };
  const exec: MockGitExec = vi.fn(async (args: string[]) => {
    const key = args.join(' ');
    for (const [pattern, resp] of Object.entries(responses)) {
      if (key.includes(pattern)) return { ...def, ...resp };
    }
    return def;
  });
  return {
    exec,
    execBuffer: makeBufferExec(exec),
    getCwd: vi.fn(() => '/repo'),
  };
}

