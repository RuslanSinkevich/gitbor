import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '../../src/core/utils/AppError';

/**
 * Тестируем приватный `handleCommand` в `MessageBridge`. Подход:
 *
 * 1) Мокаем `electron` — без него `import { ipcMain }` упадёт.
 * 2) Мокаем `./ipc/commandHandlers` через `vi.hoisted` мутируемой ссылкой:
 *    каждый тест ставит свой обработчик команды и проверяет результат.
 * 3) Не вызываем `attach()` (там подписки на electron-окно/ipcMain).
 *    Подменяем `bridge.send` на spy и зовём приватный `handleCommand`
 *    через bracket-access (TS private — compile-time only).
 *
 * Этого достаточно, чтобы покрыть всю логику ветвления handleCommand:
 * валидация формы команды, unknown type, AppError vs обычный Error.
 */

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

const { mockedHandlers } = vi.hoisted(() => ({
  mockedHandlers: {} as Record<string, (cmd: unknown, ctx: unknown) => Promise<void>>,
}));

vi.mock('../../src/core/bridge/ipc/commandHandlers', () => ({
  ipcCommandHandlers: mockedHandlers,
}));

const { MessageBridge } = await import('../../src/core/bridge/MessageBridge');

interface SentEvent {
  type: string;
  [k: string]: unknown;
}

function makeBridge(): { bridge: InstanceType<typeof MessageBridge>; sent: SentEvent[] } {
  const ch = {} as never;
  const sm = {} as never;
  const ai = null;
  const bridge = new MessageBridge(ch, sm, ai);
  const sent: SentEvent[] = [];
  // Подменяем send — лямбда-callback в handleCommand зовёт this.send,
  // так что замена на инстансе подхватится. Само окно не нужно.
  (bridge as unknown as { send: (e: SentEvent) => void }).send = (e) => {
    sent.push(e);
  };
  return { bridge, sent };
}

async function callHandle(bridge: InstanceType<typeof MessageBridge>, cmd: unknown): Promise<void> {
  await (bridge as unknown as { handleCommand: (c: unknown) => Promise<void> }).handleCommand(cmd);
}

beforeEach(() => {
  for (const k of Object.keys(mockedHandlers)) delete mockedHandlers[k];
});

describe('MessageBridge.handleCommand — невалидная команда', () => {
  it('null → error event, без throw', async () => {
    const { bridge, sent } = makeBridge();
    await expect(callHandle(bridge, null)).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('error');
    expect(typeof sent[0].message).toBe('string');
  });

  it('undefined → error event, без throw', async () => {
    const { bridge, sent } = makeBridge();
    await expect(callHandle(bridge, undefined)).resolves.toBeUndefined();
    expect(sent[0].type).toBe('error');
  });

  it('объект без поля type → error event', async () => {
    const { bridge, sent } = makeBridge();
    await callHandle(bridge, {});
    expect(sent[0]).toMatchObject({ type: 'error' });
    expect(sent[0].message).toMatch(/missing or non-string type/i);
  });

  it('type не строка (число) → error event', async () => {
    const { bridge, sent } = makeBridge();
    await callHandle(bridge, { type: 42 });
    expect(sent[0]).toMatchObject({ type: 'error' });
    expect(sent[0].message).toMatch(/missing or non-string type/i);
  });

  it('строка вместо объекта → error event', async () => {
    const { bridge, sent } = makeBridge();
    await callHandle(bridge, 'not-an-object');
    expect(sent[0].type).toBe('error');
  });
});

describe('MessageBridge.handleCommand — unknown command', () => {
  it('неизвестный type → error event с конкретным сообщением', async () => {
    const { bridge, sent } = makeBridge();
    await callHandle(bridge, { type: 'fooBarBaz' });
    expect(sent).toEqual([{ type: 'error', message: 'Unknown command: fooBarBaz' }]);
  });

  it('известный type, но без зарегистрированного обработчика → error event', async () => {
    const { bridge, sent } = makeBridge();
    // mockedHandlers пустой ⇒ никакой type не зарегистрирован.
    await callHandle(bridge, { type: 'stash' });
    expect(sent[0]).toMatchObject({ type: 'error', message: 'Unknown command: stash' });
  });
});

describe('MessageBridge.handleCommand — обычный Error в обработчике', () => {
  it('Error.message прокидывается в message, без code/data', async () => {
    mockedHandlers['stash'] = async () => {
      throw new Error('boom');
    };
    const { bridge, sent } = makeBridge();
    await callHandle(bridge, { type: 'stash' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: 'error', message: 'boom' });
    expect(sent[0]).not.toHaveProperty('code');
    expect(sent[0]).not.toHaveProperty('data');
  });

  it('non-Error throw (строка) → message = String(value)', async () => {
    mockedHandlers['stash'] = async () => {
      throw 'plain-string-error';
    };
    const { bridge, sent } = makeBridge();
    await callHandle(bridge, { type: 'stash' });
    expect(sent[0]).toEqual({ type: 'error', message: 'plain-string-error' });
  });
});

describe('MessageBridge.handleCommand — AppError в обработчике', () => {
  it('AppError → message + code + data в error event', async () => {
    mockedHandlers['stash'] = async () => {
      throw new AppError('repoErrors.notARepo', { path: '/foo' }, 'Not a Git repo: /foo');
    };
    const { bridge, sent } = makeBridge();
    await callHandle(bridge, { type: 'stash' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: 'error',
      message: 'Not a Git repo: /foo',
      code: 'repoErrors.notARepo',
      data: { path: '/foo' },
    });
  });

  it('AppError без fallback → message = code', async () => {
    mockedHandlers['stash'] = async () => {
      throw new AppError('repoErrors.invalidPath', { path: '' });
    };
    const { bridge, sent } = makeBridge();
    await callHandle(bridge, { type: 'stash' });
    expect(sent[0]).toMatchObject({
      type: 'error',
      message: 'repoErrors.invalidPath',
      code: 'repoErrors.invalidPath',
      data: { path: '' },
    });
  });
});

describe('MessageBridge.handleCommand — нормальный путь', () => {
  it('известный type → handler вызывается с командой и контекстом, error НЕ шлётся', async () => {
    const calls: Array<{ cmd: unknown; ctx: unknown }> = [];
    mockedHandlers['stash'] = async (cmd, ctx) => {
      calls.push({ cmd, ctx });
    };
    const { bridge, sent } = makeBridge();
    await callHandle(bridge, { type: 'stash', message: 'WIP' });
    expect(sent).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toEqual({ type: 'stash', message: 'WIP' });
    expect(calls[0].ctx).toMatchObject({
      ch: expect.any(Object),
      sm: expect.any(Object),
      ai: null,
      send: expect.any(Function),
    });
  });
});
