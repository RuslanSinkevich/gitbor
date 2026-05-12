import { vi, type Mock } from 'vitest';
import type { GitExecutor } from '../../src/core/git/GitExecutor';
import type { GitExecResult } from '../../src/core/git/types';

/**
 * Узкий тип «git-исполнителя» для тестов: ровно те методы реальных тестов
 * касаются на mock'е. Если очередному кейсу понадобится ещё что-то — добавь
 * именно тот метод сюда, а не размазывай Partial<GitExecutor>.
 */
export type MockGitExec = Mock<GitExecutor['exec']>;

export interface MockGit {
  exec: MockGitExec;
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

/**
 * Простейший mock GitExecutor: один и тот же ответ на любой вызов `exec`.
 * Используется в writeCommands/WorktreeManager/etc — где конкретные args
 * не важны, важен сам факт вызова.
 */
export function makeMockGit(overrides: GitExecResponse = {}): MockGit {
  const result: GitExecResult = { ...DEFAULT_RESULT, ...overrides };
  return {
    exec: vi.fn(async () => result),
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
  return {
    exec: vi.fn(async (args: string[]) => {
      const key = args.join(' ');
      for (const [pattern, resp] of Object.entries(responses)) {
        if (key.includes(pattern)) return { ...def, ...resp };
      }
      return def;
    }),
    getCwd: vi.fn(() => '/repo'),
  };
}

