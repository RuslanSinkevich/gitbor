import { describe, it, expect, vi } from 'vitest';
import { RepoServicesRegistry } from '../../src/core/services/RepoServicesRegistry';

/**
 * RepoServicesRegistry — сердце per-repo изоляции. Этот тест следит, что:
 * - `acquire(repoPath)` идемпотентен (один и тот же объект сервисов на повтор);
 * - `acquire` для разных путей даёт разные `git`/`queue`/`safety`;
 * - `bootstrap` — singleton;
 * - `release` удаляет из map и зовёт `git.killAll()`;
 * - `disposeAll` чистит и repo-сервисы, и bootstrap, и listeners;
 * - `onAnyOperationStatusChange` дёргается при write-операциях per-repo очереди.
 */
describe('RepoServicesRegistry', () => {
  it('acquire is idempotent for the same path', () => {
    const reg = new RepoServicesRegistry();
    const a1 = reg.acquire('/repo/a');
    const a2 = reg.acquire('/repo/a');
    expect(a1).toBe(a2);
    expect(a1.repoPath).toBe('/repo/a');
    reg.disposeAll();
  });

  it('acquire returns isolated services per repo path', () => {
    const reg = new RepoServicesRegistry();
    const a = reg.acquire('/repo/a');
    const b = reg.acquire('/repo/b');
    expect(a).not.toBe(b);
    expect(a.git).not.toBe(b.git);
    expect(a.queue).not.toBe(b.queue);
    expect(a.safety).not.toBe(b.safety);
    expect(reg.size()).toBe(2);
    reg.disposeAll();
  });

  it('bootstrap returns the same instance every time', () => {
    const reg = new RepoServicesRegistry();
    const b1 = reg.bootstrap();
    const b2 = reg.bootstrap();
    expect(b1).toBe(b2);
    // bootstrap не считается в size() — это отдельный кэш.
    expect(reg.size()).toBe(0);
    reg.disposeAll();
  });

  it('has() reflects acquire/release', () => {
    const reg = new RepoServicesRegistry();
    expect(reg.has('/x')).toBe(false);
    reg.acquire('/x');
    expect(reg.has('/x')).toBe(true);
    reg.release('/x');
    expect(reg.has('/x')).toBe(false);
    reg.disposeAll();
  });

  it('release calls git.killAll() and removes the entry', () => {
    const reg = new RepoServicesRegistry();
    const svc = reg.acquire('/repo/kill');
    const killSpy = vi.spyOn(svc.git, 'killAll').mockReturnValue(0);
    reg.release('/repo/kill');
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(reg.has('/repo/kill')).toBe(false);
    // Повторный release — no-op, не падает.
    expect(() => reg.release('/repo/kill')).not.toThrow();
    reg.disposeAll();
  });

  it('disposeAll kills all repos + bootstrap and clears listeners', () => {
    const reg = new RepoServicesRegistry();
    const a = reg.acquire('/repo/a');
    const b = reg.acquire('/repo/b');
    const boot = reg.bootstrap();
    const killA = vi.spyOn(a.git, 'killAll').mockReturnValue(0);
    const killB = vi.spyOn(b.git, 'killAll').mockReturnValue(0);
    const killBoot = vi.spyOn(boot.git, 'killAll').mockReturnValue(0);

    const listener = vi.fn();
    reg.onAnyOperationStatusChange(listener);

    reg.disposeAll();

    expect(killA).toHaveBeenCalledTimes(1);
    expect(killB).toHaveBeenCalledTimes(1);
    expect(killBoot).toHaveBeenCalledTimes(1);
    expect(reg.size()).toBe(0);

    // bootstrap пересоздаётся при следующем вызове (listeners пусты —
    // disposeAll должен их очистить).
    const boot2 = reg.bootstrap();
    expect(boot2).not.toBe(boot);
    reg.disposeAll();
  });

  it('onAnyOperationStatusChange notifies for per-repo queue events', async () => {
    const reg = new RepoServicesRegistry();
    const events: Array<{ running: boolean; op: string | null }> = [];
    const unsub = reg.onAnyOperationStatusChange((running, op) => {
      events.push({ running, op });
    });

    const svc = reg.acquire('/repo/q');
    await svc.queue.enqueueWrite('fetch', async () => 'ok');

    // Очередь должна была дёрнуть start (true, 'fetch') и end (false, null).
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toEqual({ running: true, op: 'fetch' });
    expect(events[events.length - 1]).toEqual({ running: false, op: null });

    unsub();
    events.length = 0;
    await svc.queue.enqueueWrite('push', async () => 'ok');
    expect(events.length).toBe(0);

    reg.disposeAll();
  });

  it('isolation: queue write on repo A does not block writes on repo B', async () => {
    const reg = new RepoServicesRegistry();
    const a = reg.acquire('/repo/a');
    const b = reg.acquire('/repo/b');

    let resolveA: () => void = () => {};
    const longA = a.queue.enqueueWrite('long', () => new Promise<void>((res) => { resolveA = res; }));

    // B должен пройти СРАЗУ, не дожидаясь A.
    const startedB = Date.now();
    await b.queue.enqueueWrite('quick', async () => 'fast');
    const elapsedB = Date.now() - startedB;
    expect(elapsedB).toBeLessThan(50);

    resolveA();
    await longA;
    reg.disposeAll();
  });
});
