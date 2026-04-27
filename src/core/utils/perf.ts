/**
 * Temporary performance instrumentation.
 * Все логи префиксуются `[perf]`, чтобы потом легко снять: grep -rn "\[perf\]"
 * или удалить файл и вызовы разом.
 *
 * Не для продакшена — убрать после оптимизации switchRepo.
 */

// Включить логи: запустить с переменной окружения SKYFORK_PERF=1
const enabled = process.env.SKYFORK_PERF === '1';

export function perfMark(label: string): () => void {
  if (!enabled) return () => {};
  const start = performance.now();
  return () => {
    const ms = performance.now() - start;
    console.log(`[perf] ${label}: ${ms.toFixed(1)}ms`);
  };
}

export async function perfAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  const end = perfMark(label);
  try {
    return await fn();
  } finally {
    end();
  }
}

export function perfSync<T>(label: string, fn: () => T): T {
  if (!enabled) return fn();
  const end = perfMark(label);
  try {
    return fn();
  } finally {
    end();
  }
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
