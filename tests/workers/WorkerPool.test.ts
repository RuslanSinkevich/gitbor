import { describe, it, expect, afterAll } from 'vitest';
import { workerPool } from '../../src/core/workers/WorkerPool';
import type { Commit } from '../../src/core/git/types';

/**
 * Здесь тестируем только inline-путь WorkerPool: для маленьких входов
 * (< OFFLOAD_THRESHOLD) пул не спавнит worker_threads, а просто вызывает
 * соответствующий GitParser/GraphLayout синхронно. Это покрытие закрывает
 * ~50% статов файла без зависимостей от Worker'ов и без рисков на CI.
 *
 * Воркер-путь (тяжёлые входы) — отдельный интеграционный сценарий, который
 * требует реальную сборку `dist/.../parserWorker.js`. На unit-уровне его не
 * тестируем — будет вечно зелёный fallback `runInline` без сюрпризов.
 */

afterAll(() => {
  workerPool.dispose();
});

describe('workerPool.parseStatus (inline path)', () => {
  it('returns an empty array for empty stdout', () => {
    const result = workerPool.parseStatus('');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it('parses staged + unstaged + untracked lines synchronously', () => {
    const stdout = [
      'M  staged.txt',
      ' M unstaged.txt',
      '?? new.txt',
    ].join('\n');
    const result = workerPool.parseStatus(stdout);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Array<{ path: string }>;
    expect(arr.length).toBe(3);
    expect(arr.map(f => f.path).sort()).toEqual(['new.txt', 'staged.txt', 'unstaged.txt']);
  });

  it('returns synchronously (not a Promise) for small inputs', () => {
    const result = workerPool.parseStatus('M  one.txt');
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('workerPool.parseCommits (inline path)', () => {
  it('returns synchronously for tiny input', () => {
    const result = workerPool.parseCommits('');
    expect(result).not.toBeInstanceOf(Promise);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });
});

describe('workerPool.computeGraphLayout (inline path)', () => {
  it('returns synchronously for tiny commit arrays', () => {
    const commits: Commit[] = [];
    const result = workerPool.computeGraphLayout(commits);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toMatchObject({
      nodes: expect.any(Array),
      maxColumns: expect.any(Number),
    });
  });

  it('produces a coherent layout for a small linear chain', () => {
    const commits: Commit[] = [
      { hash: 'c2', parents: ['c1'], authorName: 'a', authorEmail: 'a@x', authorDate: '0', subject: 's2', refs: [] } as unknown as Commit,
      { hash: 'c1', parents: [], authorName: 'a', authorEmail: 'a@x', authorDate: '0', subject: 's1', refs: [] } as unknown as Commit,
    ];
    const layout = workerPool.computeGraphLayout(commits);
    expect(layout).not.toBeInstanceOf(Promise);
    if (layout instanceof Promise) return;
    expect(layout.nodes.length).toBe(2);
    expect(layout.nodes[0].commitIndex).toBe(0);
    expect(layout.nodes[1].commitIndex).toBe(1);
    expect(layout.maxColumns).toBeGreaterThanOrEqual(0);
  });
});

describe('workerPool.dispose', () => {
  it('is idempotent — calling dispose on an empty pool is a no-op', () => {
    expect(() => workerPool.dispose()).not.toThrow();
    expect(() => workerPool.dispose()).not.toThrow();
  });
});
