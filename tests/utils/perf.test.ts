import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * perf.ts читает GITBOR_PERF в момент `import`. Чтобы протестировать обе
 * ветки (enabled / disabled), приходится переимпортировать модуль с
 * перетёртой переменной окружения через `vi.resetModules`.
 */

describe('perf (disabled — GITBOR_PERF !== "1")', () => {
  const originalEnv = process.env.GITBOR_PERF;

  beforeEach(() => {
    process.env.GITBOR_PERF = '0';
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GITBOR_PERF;
    else process.env.GITBOR_PERF = originalEnv;
    vi.restoreAllMocks();
  });

  it('perfMark returns a callable no-op that does not log', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { perfMark } = await import('../../src/core/utils/perf');
    const end = perfMark('whatever');
    expect(typeof end).toBe('function');
    end();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('perfLog is a no-op', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { perfLog } = await import('../../src/core/utils/perf');
    perfLog('whatever', { a: 1 });
    perfLog('whatever');
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('perf (enabled — GITBOR_PERF === "1")', () => {
  const originalEnv = process.env.GITBOR_PERF;

  beforeEach(() => {
    process.env.GITBOR_PERF = '1';
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GITBOR_PERF;
    else process.env.GITBOR_PERF = originalEnv;
    vi.restoreAllMocks();
  });

  it('perfMark logs "[perf] <label>: Xms" when end is called', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { perfMark } = await import('../../src/core/utils/perf');
    const end = perfMark('refreshAll');
    end();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const msg = String(logSpy.mock.calls[0][0]);
    expect(msg).toMatch(/^\[perf\] refreshAll: \d+\.\d+ms$/);
  });

  it('perfLog with extra renders "k=v" pairs space-separated', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { perfLog } = await import('../../src/core/utils/perf');
    perfLog('cache.hit', { commits: 12, bytes: 4096 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toBe('[perf] cache.hit commits=12 bytes=4096');
  });

  it('perfLog without extra logs just the label', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { perfLog } = await import('../../src/core/utils/perf');
    perfLog('cache.miss');
    expect(logSpy).toHaveBeenCalledExactlyOnceWith('[perf] cache.miss');
  });

  it('perfLog stringifies non-primitive values via String()', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { perfLog } = await import('../../src/core/utils/perf');
    perfLog('with-bool', { ok: true, missing: null });
    expect(String(logSpy.mock.calls[0][0])).toBe('[perf] with-bool ok=true missing=null');
  });
});

describe('approxJsonSize', () => {
  it('returns the JSON.stringify byte length for plain objects', async () => {
    const { approxJsonSize } = await import('../../src/core/utils/perf');
    expect(approxJsonSize({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
    expect(approxJsonSize([1, 2, 3])).toBe(JSON.stringify([1, 2, 3]).length);
    expect(approxJsonSize('plain')).toBe(JSON.stringify('plain').length);
  });

  it('returns -1 for circular structures', async () => {
    const { approxJsonSize } = await import('../../src/core/utils/perf');
    type Cyclic = { self?: Cyclic };
    const cyclic: Cyclic = {};
    cyclic.self = cyclic;
    expect(approxJsonSize(cyclic)).toBe(-1);
  });

  it('returns -1 for BigInt (cannot be serialized)', async () => {
    const { approxJsonSize } = await import('../../src/core/utils/perf');
    expect(approxJsonSize({ n: 1n })).toBe(-1);
  });
});
