import { describe, it, expect, vi, beforeEach } from 'vitest';
import { op, opWithPostMerge, errOnFail, mergeStateAfter, runTracked } from '../../src/core/bridge/ipc/helpers';
import { gitActivityStore } from '../../src/core/activity/GitActivityStore';

/**
 * Тесты на ipc/helpers — самая чувствительная точка per-repo running-флага.
 *
 * Главный инвариант: `op` снимает `repoPath` ДО старта операции. Если юзер
 * успеет переключить вкладку между `operationStart` и `operationEnd` — оба
 * события всё равно прилетят с одним и тем же repoPath (исходное активное
 * репо), и renderer корректно очистит `runningOpsByRepo` для него.
 */
describe('ipc/helpers', () => {
  beforeEach(() => {
    gitActivityStore.clear();
  });

  function makeCtx(initialRepoPath: string) {
    let repoPath = initialRepoPath;
    const sent: any[] = [];
    const ctx: any = {
      ch: {
        getMergeState: vi.fn(async () => ({ inProgress: false, sourceBranch: '', targetBranch: '', conflictedFiles: [] })),
      },
      sm: {
        getState: () => ({ repoPath }),
      },
      ai: null,
      send: (e: any) => sent.push(e),
    };
    return { ctx, sent, setRepoPath: (p: string) => { repoPath = p; } };
  }

  it('op snapshots repoPath before start; tab switch mid-op does not change end event', async () => {
    const { ctx, sent, setRepoPath } = makeCtx('/repo/A');
    const handler = op('fetch', async () => {
      // Симулируем переключение таба ВО ВРЕМЯ операции:
      setRepoPath('/repo/B');
      return { success: true };
    });

    await handler({ type: 'fetch' } as any, ctx);

    const startEv = sent.find(e => e.type === 'operationStart');
    const endEv = sent.find(e => e.type === 'operationEnd');
    expect(startEv).toBeDefined();
    expect(endEv).toBeDefined();
    expect(startEv.operation).toBe('fetch');
    expect(endEv.operation).toBe('fetch');
    expect(endEv.success).toBe(true);
    // Ключевой инвариант: оба события несут ИСХОДНЫЙ repoPath, не /repo/B.
    expect(startEv.repoPath).toBe('/repo/A');
    expect(endEv.repoPath).toBe('/repo/A');
  });

  it('op forwards error from result to end event', async () => {
    const { ctx, sent } = makeCtx('/r');
    const handler = op('push', async () => ({ success: false, error: 'remote rejected' }));
    await handler({ type: 'push' } as any, ctx);
    const endEv = sent.find(e => e.type === 'operationEnd');
    expect(endEv.success).toBe(false);
    expect(endEv.error).toBe('remote rejected');
  });

  it('op handles null repoPath (clone before any repo opened)', async () => {
    const { ctx, sent } = makeCtx('');
    const handler = op('clone', async () => ({ success: true }));
    await handler({ type: 'cloneRepo', url: '', path: '' } as any, ctx);
    const startEv = sent.find(e => e.type === 'operationStart');
    expect(startEv.repoPath).toBeNull();
  });

  it('opWithPostMerge sends mergeState after end', async () => {
    const { ctx, sent } = makeCtx('/r');
    const handler = opWithPostMerge('merge', async () => ({ success: true }));
    await handler({ type: 'merge' } as any, ctx);

    const types = sent.map(e => e.type);
    // Порядок: operationStart → operationEnd → mergeState.
    expect(types.indexOf('operationStart')).toBeLessThan(types.indexOf('operationEnd'));
    expect(types.indexOf('operationEnd')).toBeLessThan(types.indexOf('mergeState'));
  });

  it('errOnFail sends error event when result.success is false', async () => {
    const { ctx, sent } = makeCtx('/r');
    const handler = errOnFail(async () => ({ success: false, error: 'no upstream' }), 'fallback');
    await handler({ type: 'deleteBranch' } as any, ctx);
    expect(sent.some(e => e.type === 'error' && e.message === 'no upstream')).toBe(true);
  });

  it('errOnFail uses fallback message when error is missing', async () => {
    const { ctx, sent } = makeCtx('/r');
    const handler = errOnFail(async () => ({ success: false }), 'Default failure msg');
    await handler({ type: 'deleteBranch' } as any, ctx);
    expect(sent.find(e => e.type === 'error').message).toBe('Default failure msg');
  });

  it('errOnFail sends nothing on success', async () => {
    const { ctx, sent } = makeCtx('/r');
    const handler = errOnFail(async () => ({ success: true }), 'fb');
    await handler({ type: 'deleteBranch' } as any, ctx);
    expect(sent.length).toBe(0);
  });

  it('mergeStateAfter always sends mergeState event', async () => {
    const { ctx, sent } = makeCtx('/r');
    const handler = mergeStateAfter(async () => {});
    await handler({ type: 'getMergeState' } as any, ctx);
    expect(sent.find(e => e.type === 'mergeState')).toBeDefined();
  });

  it('runTracked records activity via gitActivityStore (start + finish)', async () => {
    const { ctx } = makeCtx('/repo/r1');
    const result = await runTracked('fetch', ctx, async () => ({ success: true }));
    expect(result.success).toBe(true);
    const snap = gitActivityStore.getSnapshot();
    expect(snap[0].operation).toBe('fetch');
    expect(snap[0].repoPath).toBe('/repo/r1');
    expect(snap[0].status).toBe('success');
  });

  it('runTracked marks activity as error if work throws', async () => {
    const { ctx } = makeCtx('/r');
    await expect(runTracked('push', ctx, async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    const snap = gitActivityStore.getSnapshot();
    expect(snap[0].status).toBe('error');
    expect(snap[0].error).toBe('boom');
  });
});
