import { EventEmitter } from 'events';
import { describe, it, expect, vi } from 'vitest';
import { setupGracefulShutdown } from '../../src/main/gracefulShutdown';

/**
 * Тестируем чистую функцию `setupGracefulShutdown` — без electron.
 * Используем Node EventEmitter как fake `app` (он эмитит произвольные
 * события, что и нужно: реальный Electron App тоже extends EventEmitter).
 *
 * Цели:
 * - Первый `before-quit`: preventDefault + disposeAllGracefully(timeout) + app.quit().
 * - Повторный `before-quit` (от app.quit()) не запускает dispose повторно.
 * - Если registry == null (initServices ещё не отработал) — не блокируем выход.
 */

interface FakeApp extends EventEmitter {
  quit: ReturnType<typeof vi.fn>;
}

function makeFakeApp(): FakeApp {
  const app = new EventEmitter() as FakeApp;
  app.quit = vi.fn();
  return app;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

describe('setupGracefulShutdown', () => {
  it('первый before-quit: preventDefault + disposeAllGracefully + app.quit', async () => {
    const app = makeFakeApp();
    const dispose = vi.fn(async () => {});
    const registry = { disposeAllGracefully: dispose };
    setupGracefulShutdown(app, () => registry, 200);

    const event = { preventDefault: vi.fn() };
    app.emit('before-quit', event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(200);
    expect(app.quit).not.toHaveBeenCalled();

    // Дожидаемся завершения внутреннего await disposeAllGracefully + finally → app.quit.
    await flushMicrotasks();
    await flushMicrotasks();

    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('повторный before-quit (от app.quit()) не запускает dispose снова', async () => {
    const app = makeFakeApp();
    const dispose = vi.fn(async () => {});
    setupGracefulShutdown(app, () => ({ disposeAllGracefully: dispose }), 100);

    const ev1 = { preventDefault: vi.fn() };
    app.emit('before-quit', ev1);
    await flushMicrotasks();
    await flushMicrotasks();

    // Эмулируем второй заход (после app.quit()): хендлер должен быть no-op.
    const ev2 = { preventDefault: vi.fn() };
    app.emit('before-quit', ev2);

    expect(ev2.preventDefault).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('если registry == null — не зовём preventDefault и не вешаем dispose', () => {
    const app = makeFakeApp();
    setupGracefulShutdown(app, () => null, 100);

    const ev = { preventDefault: vi.fn() };
    app.emit('before-quit', ev);

    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('app.quit() вызывается даже если disposeAllGracefully бросает', async () => {
    const app = makeFakeApp();
    const dispose = vi.fn(async () => {
      throw new Error('boom');
    });
    setupGracefulShutdown(app, () => ({ disposeAllGracefully: dispose }), 50);

    const event = { preventDefault: vi.fn() };
    app.emit('before-quit', event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    await flushMicrotasks();

    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('таймаут по умолчанию = 1500мс если не передан явный', async () => {
    const app = makeFakeApp();
    const dispose = vi.fn(async () => {});
    setupGracefulShutdown(app, () => ({ disposeAllGracefully: dispose }));

    app.emit('before-quit', { preventDefault: vi.fn() });

    expect(dispose).toHaveBeenCalledWith(1500);
  });

  it('getRegistry опрашивается на КАЖДЫЙ before-quit (lazy)', () => {
    const app = makeFakeApp();
    let current: { disposeAllGracefully: () => Promise<void> } | null = null;
    setupGracefulShutdown(app, () => current, 100);

    const ev1 = { preventDefault: vi.fn() };
    app.emit('before-quit', ev1);
    expect(ev1.preventDefault).not.toHaveBeenCalled();

    // initServices «отработал» — registry появился.
    const dispose = vi.fn(async () => {});
    current = { disposeAllGracefully: dispose };

    const ev2 = { preventDefault: vi.fn() };
    app.emit('before-quit', ev2);
    expect(ev2.preventDefault).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
