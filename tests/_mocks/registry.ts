import type { RepoServices, RepoServicesRegistry } from '../../src/core/services/RepoServicesRegistry';
import type { MockGit } from './git';

/**
 * Узкий тип фейкового `OperationQueue` для StateManager-тестов: реальная
 * очередь ему не нужна, нужно лишь чтобы op() выполнился.
 */
export interface FakeServicesQueue {
  enqueueRead: <T>(label: string, op: () => Promise<T>) => Promise<T>;
  enqueueWrite: <T>(label: string, op: () => Promise<T>) => Promise<T>;
  onStatusChange: (cb: (running: boolean, op: string | null) => void) => () => void;
}

/** Узкий тип фейкового SafetyNet — точка `wrapDestructive`. */
export interface FakeServicesSafety {
  wrapDestructive: <T>(
    op: string,
    params: Record<string, string>,
    operation: () => Promise<T>,
  ) => Promise<T>;
}

/**
 * Контейнер фейковых per-repo сервисов. Не реальный RepoServices (там
 * жёсткие классы), а структурно совместимая форма — её хватает StateManager'у
 * через `getActiveServices()`.
 */
export interface FakeRepoServices {
  repoPath: string;
  git: MockGit;
  queue: FakeServicesQueue;
  safety: FakeServicesSafety;
}

function makeFakeServices(git: MockGit, repoPath = '/repo'): FakeRepoServices {
  return {
    repoPath,
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
}

/**
 * Фейковый `RepoServicesRegistry` для StateManager-тестов. Возвращает
 * один и тот же набор сервисов на любой `acquire`/`get`/`bootstrap`.
 *
 * Возврат — неполный по сравнению с реальным registry; кастуем единожды
 * в `RepoServicesRegistry` чтобы StateManager принял его в конструкторе.
 * RepoServices форму внутри держим узкой, но объявляем её как `RepoServices`
 * для совместимости.
 */
export function makeFakeRegistry(git: MockGit, repoPath = '/repo'): RepoServicesRegistry {
  // Внутри теста RepoServices — структурно совместимая форма, не реальные
  // GitExecutor/Queue/SafetyNet классы. Кастуем точечно.
  const services = makeFakeServices(git, repoPath) as unknown as RepoServices;
  const registry = {
    has: () => true,
    bootstrap: () => services,
    acquire: () => services,
    get: () => services,
    release: () => {},
    disposeAll: () => {},
    onAnyOperationStatusChange: () => () => {},
    size: () => 1,
  };
  return registry as unknown as RepoServicesRegistry;
}

/**
 * Тип «голого» git, обогащённого extension-методами для StateManager.
 * Раньше тестовый код каждый раз делал `(git as any).killAll = vi.fn(...)`;
 * теперь все нужные методы лежат в MockGit и опциональны.
 */
export type StateManagerMockGit = MockGit & {
  setCwd: NonNullable<MockGit['setCwd']>;
  killAll: NonNullable<MockGit['killAll']>;
};
