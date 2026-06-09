import { vi, type Mock } from 'vitest';
import type { MainEvent, MergeState } from '../../src/core/bridge/messages';
import type { HandlerContext } from '../../src/core/bridge/ipc/types';
import type { CommandHandler } from '../../src/core/commands/CommandHandler';
import type { AppState } from '../../src/core/git/types';

/** Минимальный mock `CommandHandler` для bridge/helpers-тестов. */
export interface MockCommandHandler {
  getMergeState: Mock<CommandHandler['getMergeState']>;
  getMergeStateForRepo: Mock<CommandHandler['getMergeStateForRepo']>;
}

/** Минимальный mock `StateManager` для bridge-контекста. */
export interface MockBridgeState {
  getState: Mock<() => Pick<AppState, 'repoPath'>>;
}

/**
 * Mock `HandlerContext` — только те поля, которые читаются в helpers
 * (`ch.getMergeState`, `sm.getState`, `ai`, `send`). Возвращает
 * массив `sent` для удобной проверки эмитированных событий.
 */
export interface MockBridgeContext {
  ctx: HandlerContext;
  sent: MainEvent[];
  setRepoPath: (p: string) => void;
}

const EMPTY_MERGE_STATE: MergeState = {
  inProgress: false,
  sourceBranch: '',
  targetBranch: '',
  totalConflicts: 0,
  resolvedConflicts: 0,
  conflictFiles: [],
};

export function makeMockBridgeContext(initialRepoPath: string): MockBridgeContext {
  let repoPath = initialRepoPath;
  const sent: MainEvent[] = [];

  const ch: MockCommandHandler = {
    getMergeState: vi.fn(async () => EMPTY_MERGE_STATE),
    getMergeStateForRepo: vi.fn(async () => EMPTY_MERGE_STATE),
  };
  const sm: MockBridgeState = {
    getState: vi.fn(() => ({ repoPath })),
  };

  // HandlerContext в проде требует полные `CommandHandler` / `StateManager`;
  // helpers же касаются только перечисленного поверх. Кастуем точечно — это
  // единственное оправданное место «as unknown as HandlerContext».
  const ctx = {
    ch,
    sm,
    ai: null,
    send: (event: MainEvent) => {
      sent.push(event);
    },
  } as unknown as HandlerContext;

  return {
    ctx,
    sent,
    setRepoPath: (p: string) => {
      repoPath = p;
    },
  };
}
