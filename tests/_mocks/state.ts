import { vi, type Mock } from 'vitest';
import type { AppState } from '../../src/core/git/types';
import type { StateManager } from '../../src/core/state/StateManager';

/**
 * Узкий mock `StateManager` для writeCommands/ConflictManager-тестов:
 * только методы, которые реально вызываются (refresh*, getState, setRepoPath,
 * switchRepo). Если потребуется ещё — добавь сюда поле, чтобы не плодить
 * локальные `Pick<>` по тестам.
 */
export interface MockState {
  refreshAll: Mock<StateManager['refreshAll']>;
  refreshStatusAndNotify: Mock<StateManager['refreshStatusAndNotify']>;
  setRepoPath: Mock<StateManager['setRepoPath']>;
  switchRepo: Mock<StateManager['switchRepo']>;
  getState: Mock<() => Pick<AppState, 'repoPath'>>;
}

export function makeMockState(repoPath = '/repo'): MockState {
  return {
    refreshAll: vi.fn(async () => {}),
    refreshStatusAndNotify: vi.fn(async () => {}),
    setRepoPath: vi.fn(),
    switchRepo: vi.fn(async () => {}),
    getState: vi.fn(() => ({ repoPath })),
  };
}
