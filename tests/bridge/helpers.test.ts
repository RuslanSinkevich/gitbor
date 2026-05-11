import { describe, it, expect, beforeEach } from 'vitest';
import { op, opWithPostMerge, errOnFail, mergeStateAfter, runTracked } from '../../src/core/bridge/ipc/helpers';
import { gitActivityStore } from '../../src/core/activity/GitActivityStore';
import type { CmdOf } from '../../src/core/bridge/ipc/types';
import type { MainEvent, RendererCommand } from '../../src/core/bridge/messages';
import { makeMockBridgeContext } from '../_mocks';

/**
 * Тесты на ipc/helpers — самая чувствительная точка per-repo running-флага.
 *
 * Главный инвариант: `op` снимает `repoPath` ДО старта операции. Если юзер
 * успеет переключить вкладку между `operationStart` и `operationEnd` — оба
 * события всё равно прилетят с одним и тем же repoPath (исходное активное
 * репо), и renderer корректно очистит `runningOpsByRepo` для него.
 */

type SentEvent<K extends MainEvent['type']> = Extract<MainEvent, { type: K }>;

function findEvent<K extends MainEvent['type']>(events: MainEvent[], type: K): SentEvent<K> | undefined {
  return events.find((e): e is SentEvent<K> => e.type === type);
}

function commandOf<K extends RendererCommand['type']>(type: K, extra: Omit<CmdOf<K>, 'type'> | object = {}): CmdOf<K> {
  return { type, ...(extra as object) } as CmdOf<K>;
}

describe('ipc/helpers', () => {
  beforeEach(() => {
    gitActivityStore.clear();
  });

  it('op snapshots repoPath before start; tab switch mid-op does not change end event', async () => {
    const { ctx, sent, setRepoPath } = makeMockBridgeContext('/repo/A');
    const handler = op('fetch', async () => {
      // Симулируем переключение таба ВО ВРЕМЯ операции:
      setRepoPath('/repo/B');
      return { success: true };
    });

    await handler(commandOf('fetch'), ctx);

    const startEv = findEvent(sent, 'operationStart');
    const endEv = findEvent(sent, 'operationEnd');
    expect(startEv).toBeDefined();
    expect(endEv).toBeDefined();
    expect(startEv!.operation).toBe('fetch');
    expect(endEv!.operation).toBe('fetch');
    expect(endEv!.success).toBe(true);
    // Ключевой инвариант: оба события несут ИСХОДНЫЙ repoPath, не /repo/B.
    expect(startEv!.repoPath).toBe('/repo/A');
    expect(endEv!.repoPath).toBe('/repo/A');
  });

  it('op forwards error from result to end event', async () => {
    const { ctx, sent } = makeMockBridgeContext('/r');
    const handler = op('push', async () => ({ success: false, error: 'remote rejected' }));
    await handler(commandOf('push'), ctx);
    const endEv = findEvent(sent, 'operationEnd');
    expect(endEv!.success).toBe(false);
    expect(endEv!.error).toBe('remote rejected');
  });

  it('op handles null repoPath (clone before any repo opened)', async () => {
    const { ctx, sent } = makeMockBridgeContext('');
    const handler = op('clone', async () => ({ success: true }));
    await handler(commandOf('cloneRepo', { url: '', path: '' }), ctx);
    const startEv = findEvent(sent, 'operationStart');
    expect(startEv!.repoPath).toBeNull();
  });

  it('opWithPostMerge sends mergeState after end', async () => {
    const { ctx, sent } = makeMockBridgeContext('/r');
    const handler = opWithPostMerge('merge', async () => ({ success: true }));
    await handler(commandOf('merge', { branch: 'main' }), ctx);

    const types = sent.map(e => e.type);
    // Порядок: operationStart → operationEnd → mergeState.
    expect(types.indexOf('operationStart')).toBeLessThan(types.indexOf('operationEnd'));
    expect(types.indexOf('operationEnd')).toBeLessThan(types.indexOf('mergeState'));
  });

  it('errOnFail sends error event when result.success is false', async () => {
    const { ctx, sent } = makeMockBridgeContext('/r');
    const handler = errOnFail(async () => ({ success: false, error: 'no upstream' }), 'fallback');
    await handler(commandOf('deleteBranch', { branch: 'x' }), ctx);
    expect(sent.some(e => e.type === 'error' && e.message === 'no upstream')).toBe(true);
  });

  it('errOnFail uses fallback message when error is missing', async () => {
    const { ctx, sent } = makeMockBridgeContext('/r');
    const handler = errOnFail(async () => ({ success: false }), 'Default failure msg');
    await handler(commandOf('deleteBranch', { branch: 'x' }), ctx);
    const errEv = findEvent(sent, 'error');
    expect(errEv!.message).toBe('Default failure msg');
  });

  it('errOnFail sends nothing on success', async () => {
    const { ctx, sent } = makeMockBridgeContext('/r');
    const handler = errOnFail(async () => ({ success: true }), 'fb');
    await handler(commandOf('deleteBranch', { branch: 'x' }), ctx);
    expect(sent.length).toBe(0);
  });

  it('mergeStateAfter always sends mergeState event', async () => {
    const { ctx, sent } = makeMockBridgeContext('/r');
    const handler = mergeStateAfter(async () => {});
    await handler(commandOf('getMergeState'), ctx);
    expect(findEvent(sent, 'mergeState')).toBeDefined();
  });

  it('runTracked records activity via gitActivityStore (start + finish)', async () => {
    const { ctx } = makeMockBridgeContext('/repo/r1');
    const result = await runTracked('fetch', ctx, async () => ({ success: true }));
    expect(result.success).toBe(true);
    const snap = gitActivityStore.getSnapshot();
    expect(snap[0].operation).toBe('fetch');
    expect(snap[0].repoPath).toBe('/repo/r1');
    expect(snap[0].status).toBe('success');
  });

  it('runTracked marks activity as error if work throws', async () => {
    const { ctx } = makeMockBridgeContext('/r');
    await expect(runTracked('push', ctx, async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    const snap = gitActivityStore.getSnapshot();
    expect(snap[0].status).toBe('error');
    expect(snap[0].error).toBe('boom');
  });
});
