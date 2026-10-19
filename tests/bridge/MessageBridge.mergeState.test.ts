import { describe, it, expect, vi } from 'vitest';

/**
 * Обновление `mergeState` по `stateUpdate`: после merge-коммита вне Gitbor
 * MERGE_HEAD пропадает, а список UU не меняется (конфликты уже разрешены).
 * Без HEAD в подписи bridge не перезапрашивал mergeState, и в тулбаре
 * висела кнопка «Отменить» для уже завершённого слияния.
 */

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

const { MessageBridge } = await import('../../src/core/bridge/MessageBridge');

type Listener = (state: Record<string, unknown>) => void;

function makeState(head: string, conflicts: string[] = []): Record<string, unknown> {
  return {
    repoPath: '/repo',
    currentBranch: 'feature',
    branches: [{ name: 'feature', hash: head, isCurrent: true, isRemote: false }],
    conflicts,
    commits: [],
    graphLayout: { nodes: [] },
  };
}

function setup(mergeStates: Array<{ inProgress: boolean }>) {
  let listener: Listener = () => {};
  let current = makeState('a');
  const sm = {
    subscribe: (fn: Listener) => { listener = fn; return () => {}; },
    getState: () => current,
  };
  const getMergeStateForRepo = vi.fn(async () => mergeStates.shift() ?? { inProgress: false });
  const ch = { getMergeStateForRepo };
  const bridge = new MessageBridge(ch as never, sm as never, null);
  const sent: Array<{ type: string; data?: { inProgress: boolean } }> = [];
  (bridge as unknown as { send: (e: never) => void }).send = (e: { type: string; data?: { inProgress: boolean } }) => {
    if (e.type === 'mergeState') {
      (bridge as unknown as { lastMergeStateInProgress: boolean }).lastMergeStateInProgress = !!e.data?.inProgress;
    }
    sent.push(e);
  };
  bridge.attach({ on: vi.fn() } as never);
  const emit = async (state: Record<string, unknown>) => {
    current = state;
    listener(state);
    await new Promise(r => setTimeout(r, 0));
  };
  return { emit, sent, getMergeStateForRepo };
}

describe('MessageBridge — mergeState по stateUpdate', () => {
  it('merge-коммит без изменения UU → mergeState перезапрашивается и сбрасывается', async () => {
    const { emit, sent } = setup([{ inProgress: true }, { inProgress: false }]);
    await emit(makeState('a'));
    expect(sent.filter(e => e.type === 'mergeState').at(-1)?.data?.inProgress).toBe(true);

    await emit(makeState('b'));
    expect(sent.filter(e => e.type === 'mergeState').at(-1)?.data?.inProgress).toBe(false);
  });

  it('смена HEAD без активного слияния → лишних запросов нет', async () => {
    const { emit, getMergeStateForRepo } = setup([{ inProgress: false }]);
    await emit(makeState('a'));
    await emit(makeState('b'));
    expect(getMergeStateForRepo).toHaveBeenCalledTimes(1);
  });
});
