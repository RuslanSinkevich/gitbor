import { describe, it, expect, vi } from 'vitest';
import { OperationQueue } from '../../src/core/safety/OperationQueue';

describe('OperationQueue', () => {
  it('starts with no write running', () => {
    const q = new OperationQueue();
    expect(q.isWriteRunning()).toBe(false);
    expect(q.getQueueLength()).toBe(0);
    expect(q.getCurrentOperation()).toBeNull();
  });

  it('executes a read operation', async () => {
    const q = new OperationQueue();
    const result = await q.enqueueRead('test', async () => 42);
    expect(result).toBe(42);
  });

  it('executes a write operation', async () => {
    const q = new OperationQueue();
    const result = await q.enqueueWrite('test', async () => 'done');
    expect(result).toBe('done');
  });

  it('serializes write operations', async () => {
    const q = new OperationQueue();
    const order: number[] = [];

    const p1 = q.enqueueWrite('w1', async () => {
      await new Promise(r => setTimeout(r, 50));
      order.push(1);
    });
    const p2 = q.enqueueWrite('w2', async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('allows parallel reads', async () => {
    const q = new OperationQueue();
    const starts: number[] = [];
    const t0 = Date.now();

    const p1 = q.enqueueRead('r1', async () => {
      starts.push(Date.now() - t0);
      await new Promise(r => setTimeout(r, 50));
      return 1;
    });
    const p2 = q.enqueueRead('r2', async () => {
      starts.push(Date.now() - t0);
      await new Promise(r => setTimeout(r, 50));
      return 2;
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    // Both reads should start nearly simultaneously
    expect(Math.abs(starts[0] - starts[1])).toBeLessThan(30);
  });

  it('notifies status listeners', async () => {
    const q = new OperationQueue();
    const calls: [boolean, string | null][] = [];
    q.onStatusChange((running, op) => calls.push([running, op]));

    await q.enqueueWrite('myOp', async () => {});
    expect(calls).toContainEqual([true, 'myOp']);
    expect(calls).toContainEqual([false, null]);
  });

  it('unsubscribes listener', async () => {
    const q = new OperationQueue();
    const listener = vi.fn();
    const unsub = q.onStatusChange(listener);
    unsub();
    await q.enqueueWrite('x', async () => {});
    expect(listener).not.toHaveBeenCalled();
  });

  it('propagates errors from operations', async () => {
    const q = new OperationQueue();
    await expect(
      q.enqueueWrite('fail', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });

  it('continues processing after error', async () => {
    const q = new OperationQueue();
    try {
      await q.enqueueWrite('fail', async () => { throw new Error('x'); });
    } catch {}
    const result = await q.enqueueWrite('ok', async () => 'recovered');
    expect(result).toBe('recovered');
  });
});
