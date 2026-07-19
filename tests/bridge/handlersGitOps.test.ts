import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcHandlersGitOps } from '../../src/core/bridge/ipc/handlersGitOps';
import { gitActivityStore } from '../../src/core/activity/GitActivityStore';

/**
 * Тесты на ipcHandlersGitOps — проверяют, что table-handlers корректно
 * прокидывают аргументы команды в CommandHandler и формируют поток событий.
 *
 * Особый интерес — stash: cmd.message может быть undefined / '' / реальной
 * строкой, и в каждом случае chain должна довести значение до Write.stash
 * без потерь и без подмены на null/строку «undefined».
 */

interface SentEvent { type: string; [k: string]: unknown }

function makeCtx(opts: {
  repoPath?: string;
  ch?: Partial<{
    stash: (m?: string) => Promise<{ success: boolean; error?: string }>;
    stashPop: () => Promise<{ success: boolean; error?: string }>;
    stashApply: (i: string) => Promise<{ success: boolean; error?: string }>;
    stashDrop: (i: string) => Promise<{ success: boolean; error?: string }>;
    stashShow: (i: string) => Promise<unknown[]>;
    fetch: (r?: string) => Promise<{ success: boolean; error?: string }>;
    pull: (r?: boolean, a?: boolean) => Promise<{ success: boolean; error?: string }>;
  }>;
} = {}) {
  const sent: SentEvent[] = [];
  const ch = {
    stash: vi.fn(async () => ({ success: true })),
    stashPop: vi.fn(async () => ({ success: true })),
    stashApply: vi.fn(async () => ({ success: true })),
    stashDrop: vi.fn(async () => ({ success: true })),
    stashShow: vi.fn(async () => []),
    fetch: vi.fn(async () => ({ success: true })),
    pull: vi.fn(async () => ({ success: true })),
    getMergeState: vi.fn(async () => ({
      inProgress: false, sourceBranch: '', targetBranch: '', conflictedFiles: [],
    })),
    getMergeStateForRepo: vi.fn(async () => ({
      inProgress: false, sourceBranch: '', targetBranch: '', conflictedFiles: [],
    })),
    ...opts.ch,
  };
  const ctx = {
    ch,
    sm: { getState: () => ({ repoPath: opts.repoPath ?? '/repo' }) },
    ai: null,
    send: (e: SentEvent) => sent.push(e),
  };
  return { ctx, sent, ch };
}

beforeEach(() => {
  gitActivityStore.clear();
});

describe('ipcHandlersGitOps.stash', () => {
  it('passes message from RendererCommand into CommandHandler.stash', async () => {
    const { ctx, ch } = makeCtx();
    await ipcHandlersGitOps.stash!(
      { type: 'stash', message: 'WIP login' } as never,
      ctx as never,
    );
    expect(ch.stash).toHaveBeenCalledTimes(1);
    expect(ch.stash).toHaveBeenCalledWith('WIP login', undefined);
  });

  it('passes undefined when cmd.message is missing', async () => {
    const { ctx, ch } = makeCtx();
    await ipcHandlersGitOps.stash!({ type: 'stash' } as never, ctx as never);
    expect(ch.stash).toHaveBeenCalledTimes(1);
    expect(ch.stash.mock.calls[0][0]).toBeUndefined();
  });

  it('passes empty string verbatim (does not coerce to undefined)', async () => {
    const { ctx, ch } = makeCtx();
    await ipcHandlersGitOps.stash!(
      { type: 'stash', message: '' } as never,
      ctx as never,
    );
    expect(ch.stash).toHaveBeenCalledWith('', undefined);
  });

  it('forwards includeUntracked flag to CommandHandler.stash', async () => {
    const { ctx, ch } = makeCtx();
    await ipcHandlersGitOps.stash!(
      { type: 'stash', message: 'WIP', includeUntracked: true } as never,
      ctx as never,
    );
    expect(ch.stash).toHaveBeenCalledWith('WIP', true);
  });

  it('emits operationStart and operationEnd around the call (success)', async () => {
    const { ctx, sent } = makeCtx({ repoPath: '/repo/X' });
    await ipcHandlersGitOps.stash!(
      { type: 'stash', message: 'msg' } as never,
      ctx as never,
    );
    const start = sent.find(e => e.type === 'operationStart');
    const end = sent.find(e => e.type === 'operationEnd');
    expect(start).toMatchObject({ operation: 'stash', repoPath: '/repo/X' });
    expect(end).toMatchObject({ operation: 'stash', success: true, repoPath: '/repo/X' });
  });

  it('forwards error from CommandHandler.stash to operationEnd event', async () => {
    const { ctx, sent } = makeCtx({
      ch: { stash: vi.fn(async () => ({ success: false, error: 'no local changes to save' })) },
    });
    await ipcHandlersGitOps.stash!({ type: 'stash' } as never, ctx as never);
    const end = sent.find(e => e.type === 'operationEnd');
    expect(end).toMatchObject({ success: false, error: 'no local changes to save' });
  });
});

describe('ipcHandlersGitOps.stashPop', () => {
  it('calls CommandHandler.stashPop with no args', async () => {
    const { ctx, ch } = makeCtx();
    await ipcHandlersGitOps.stashPop!({ type: 'stashPop' } as never, ctx as never);
    expect(ch.stashPop).toHaveBeenCalledTimes(1);
    expect(ch.stashPop).toHaveBeenCalledWith();
  });
});

describe('ipcHandlersGitOps.stashApply / stashDrop', () => {
  it('stashApply forwards index and emits no error event on success', async () => {
    const { ctx, sent, ch } = makeCtx();
    await ipcHandlersGitOps.stashApply!(
      { type: 'stashApply', index: 'stash@{1}' } as never,
      ctx as never,
    );
    expect(ch.stashApply).toHaveBeenCalledWith('stash@{1}');
    expect(sent.length).toBe(0);
  });

  it('stashDrop emits error event when CommandHandler returns failure', async () => {
    const { ctx, sent } = makeCtx({
      ch: { stashDrop: vi.fn(async () => ({ success: false, error: 'no such stash' })) },
    });
    await ipcHandlersGitOps.stashDrop!(
      { type: 'stashDrop', index: 'stash@{9}' } as never,
      ctx as never,
    );
    const err = sent.find(e => e.type === 'error');
    expect(err).toMatchObject({ message: 'no such stash' });
  });

  it('stashDrop falls back to default message if error is missing', async () => {
    const { ctx, sent } = makeCtx({
      ch: { stashDrop: vi.fn(async () => ({ success: false })) },
    });
    await ipcHandlersGitOps.stashDrop!(
      { type: 'stashDrop', index: 'stash@{0}' } as never,
      ctx as never,
    );
    const err = sent.find(e => e.type === 'error');
    expect(err?.message).toBe('Stash drop failed');
  });
});

describe('ipcHandlersGitOps.stashPopIndex', () => {
  it('on apply success → drops the stash and sends nothing', async () => {
    const { ctx, sent, ch } = makeCtx();
    await ipcHandlersGitOps.stashPopIndex!(
      { type: 'stashPopIndex', index: 'stash@{0}' } as never,
      ctx as never,
    );
    expect(ch.stashApply).toHaveBeenCalledWith('stash@{0}');
    expect(ch.stashDrop).toHaveBeenCalledWith('stash@{0}');
    expect(sent.length).toBe(0);
  });

  it('on apply success but drop failure → sends error with drop message', async () => {
    const { ctx, sent } = makeCtx({
      ch: {
        stashApply: vi.fn(async () => ({ success: true })),
        stashDrop: vi.fn(async () => ({ success: false, error: 'permission denied' })),
      },
    });
    await ipcHandlersGitOps.stashPopIndex!(
      { type: 'stashPopIndex', index: 'stash@{0}' } as never,
      ctx as never,
    );
    expect(sent.find(e => e.type === 'error')?.message).toBe('permission denied');
  });

  it('on apply failure → does NOT drop and sends error preserving the stash', async () => {
    const { ctx, sent, ch } = makeCtx({
      ch: {
        stashApply: vi.fn(async () => ({ success: false, error: 'conflict' })),
      },
    });
    await ipcHandlersGitOps.stashPopIndex!(
      { type: 'stashPopIndex', index: 'stash@{0}' } as never,
      ctx as never,
    );
    expect(ch.stashDrop).not.toHaveBeenCalled();
    expect(sent.find(e => e.type === 'error')?.message).toBe('conflict');
  });
});

describe('ipcHandlersGitOps.stashShow', () => {
  it('sends stashDiff event with index and diffs', async () => {
    const diffs = [{ file: 'a.ts', hunks: [] }];
    const { ctx, sent } = makeCtx({
      ch: { stashShow: vi.fn(async () => diffs as unknown[]) },
    });
    await ipcHandlersGitOps.stashShow!(
      { type: 'stashShow', index: 'stash@{0}' } as never,
      ctx as never,
    );
    const ev = sent.find(e => e.type === 'stashDiff');
    expect(ev).toMatchObject({ index: 'stash@{0}', data: diffs });
  });
});

describe('ipcHandlersGitOps.fetch / pull (regression — operation name)', () => {
  it('fetch handler announces operation="fetch"', async () => {
    const { ctx, sent } = makeCtx();
    await ipcHandlersGitOps.fetch!({ type: 'fetch' } as never, ctx as never);
    expect(sent.find(e => e.type === 'operationStart')?.operation).toBe('fetch');
    expect(sent.find(e => e.type === 'operationEnd')?.operation).toBe('fetch');
  });

  it('fetchBranch handler announces operation="fetchBranch"', async () => {
    const fetchBranch = vi.fn(async () => ({ success: true }));
    const { ctx, sent } = makeCtx({ ch: { fetchBranch } as never });
    await ipcHandlersGitOps.fetchBranch!(
      { type: 'fetchBranch', branch: 'feature' } as never,
      ctx as never,
    );
    expect(sent.find(e => e.type === 'operationStart')?.operation).toBe('fetchBranch');
    expect(sent.find(e => e.type === 'operationEnd')?.operation).toBe('fetchBranch');
    expect(fetchBranch).toHaveBeenCalledWith('feature', undefined, undefined);
  });

  it('pull handler forwards rebase + autostash flags into CommandHandler.pull', async () => {
    const { ctx, ch } = makeCtx();
    await ipcHandlersGitOps.pull!(
      { type: 'pull', rebase: true, autostash: true } as never,
      ctx as never,
    );
    expect(ch.pull).toHaveBeenCalledWith(true, true);
  });
});
