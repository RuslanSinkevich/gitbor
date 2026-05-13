/**
 * Performance instrumentation. Все логи префиксуются `[perf]`, чтобы потом
 * легко снять: grep -rn "\[perf\]" или удалить вызовы разом.
 *
 * Включается переменной окружения `GITBOR_PERF=1`. По умолчанию выключено
 * и все обёртки вырождаются в no-op (zero-overhead в production).
 */

const enabled = process.env.GITBOR_PERF === '1';

export function perfMark(label: string): () => void {
  if (!enabled) return () => {};
  const start = performance.now();
  return () => {
    const ms = performance.now() - start;
    console.log(`[perf] ${label}: ${ms.toFixed(1)}ms`);
  };
}

export function perfLog(label: string, extra?: Record<string, unknown>): void {
  if (!enabled) return;
  if (extra) {
    const pairs = Object.entries(extra).map(([k, v]) => `${k}=${String(v)}`).join(' ');
    console.log(`[perf] ${label} ${pairs}`);
  } else {
    console.log(`[perf] ${label}`);
  }
}

export function approxJsonSize(obj: unknown): number {
  try {
    return JSON.stringify(obj).length;
  } catch {
    return -1;
  }
}
