/**
 * Temporary performance instrumentation (renderer side).
 * Все логи префиксуются `[perf]`, чтобы потом легко снять.
 */

// Включается флагом window.__SKYFORK_PERF__ = true в DevTools Console.
// По умолчанию выключено, т.к. сотни console.log в открытом DevTools
// сами по себе дают ощутимый лаг (десятки мс на switch).
declare global {
  interface Window {
    __SKYFORK_PERF__?: boolean;
  }
}

function isEnabled(): boolean {
  return typeof window !== 'undefined' && window.__SKYFORK_PERF__ === true;
}

export function perfMark(label: string): () => void {
  if (!isEnabled()) return () => {};
  const start = performance.now();
  return () => {
    const ms = performance.now() - start;
    console.log(`[perf] ${label}: ${ms.toFixed(1)}ms`);
  };
}

export function perfLog(label: string, extra?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  if (extra) {
    const pairs = Object.entries(extra).map(([k, v]) => `${k}=${String(v)}`).join(' ');
    console.log(`[perf] ${label} ${pairs}`);
  } else {
    console.log(`[perf] ${label}`);
  }
}
