import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitActivityStore, type ActivityEvent } from '../../src/core/activity/GitActivityStore';

/**
 * GitActivityStore хранит журнал git-операций. Тесты следят, что:
 * - `start` создаёт running-entry с `repoPath` (тот сам его привязывает
 *   рендерер для per-repo фильтрации журнала);
 * - `appendCommand` добавляет команду к существующей записи и эмитит updated;
 * - `appendCommand` для несуществующего id — no-op (а не throw);
 * - `finish` ставит status и finishedAt;
 * - `clear` чистит и эмитит cleared;
 * - `subscribe` отписка работает;
 * - кэп на `MAX_ENTRIES = 100` соблюдается;
 * - длинный stdout/stderr обрезается до OUTPUT_CAP_BYTES.
 */
describe('GitActivityStore', () => {
  let store: GitActivityStore;

  beforeEach(() => {
    store = new GitActivityStore();
  });

  it('start creates a running entry with repoPath', () => {
    const id = store.start('fetch', '/repo/a');
    const snap = store.getSnapshot();
    expect(snap.length).toBe(1);
    expect(snap[0].id).toBe(id);
    expect(snap[0].operation).toBe('fetch');
    expect(snap[0].repoPath).toBe('/repo/a');
    expect(snap[0].status).toBe('running');
    expect(snap[0].finishedAt).toBeNull();
    expect(snap[0].error).toBeNull();
    expect(snap[0].commands).toEqual([]);
  });

  it('start with null repoPath is allowed (clone/init before openRepo)', () => {
    const id = store.start('clone', null);
    expect(store.getSnapshot()[0].repoPath).toBeNull();
    expect(id).toBeTruthy();
  });

  it('appendCommand adds to the entry and emits updated', () => {
    const events: ActivityEvent[] = [];
    store.subscribe(e => events.push(e));
    const id = store.start('pull', '/r');
    store.appendCommand(id, {
      args: ['pull', '--rebase'],
      cwd: '/r',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 42,
      startedAt: 1,
    });
    const entry = store.getSnapshot()[0];
    expect(entry.commands.length).toBe(1);
    expect(entry.commands[0].args).toEqual(['pull', '--rebase']);
    expect(events.some(e => e.type === 'added')).toBe(true);
    expect(events.some(e => e.type === 'updated')).toBe(true);
  });

  it('appendCommand on unknown id is a no-op (does not throw)', () => {
    expect(() => store.appendCommand('does-not-exist', {
      args: [], cwd: '', exitCode: 0, stdout: '', stderr: '', durationMs: 0, startedAt: 0,
    })).not.toThrow();
    expect(store.getSnapshot().length).toBe(0);
  });

  it('finish sets success status and finishedAt', () => {
    const id = store.start('push', '/r');
    store.finish(id, true);
    const e = store.getSnapshot()[0];
    expect(e.status).toBe('success');
    expect(e.finishedAt).toBeTypeOf('number');
    expect(e.error).toBeNull();
  });

  it('finish with error sets error status and message', () => {
    const id = store.start('push', '/r');
    store.finish(id, false, 'remote rejected');
    const e = store.getSnapshot()[0];
    expect(e.status).toBe('error');
    expect(e.error).toBe('remote rejected');
  });

  it('clear empties entries and emits cleared', () => {
    const events: ActivityEvent[] = [];
    store.subscribe(e => events.push(e));
    store.start('a', '/r');
    store.start('b', '/r');
    store.clear();
    expect(store.getSnapshot()).toEqual([]);
    expect(events.find(e => e.type === 'cleared')).toBeTruthy();
  });

  it('subscribe returns unsubscribe that stops further events', () => {
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    store.start('a', '/r');
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    store.start('b', '/r');
    // count не растёт, потому что unsub отвязал слушателя.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('newest entries come first (unshift)', () => {
    const a = store.start('a', '/r');
    const b = store.start('b', '/r');
    const c = store.start('c', '/r');
    const order = store.getSnapshot().map(e => e.id);
    expect(order).toEqual([c, b, a]);
  });

  it('caps entries at 100', () => {
    for (let i = 0; i < 150; i++) store.start('op-' + i, '/r');
    expect(store.getSnapshot().length).toBe(100);
  });

  it('truncates oversized stdout/stderr in appendCommand', () => {
    const id = store.start('big', '/r');
    const huge = 'x'.repeat(20 * 1024); // 20 KiB > 16 KiB cap
    store.appendCommand(id, {
      args: ['log'], cwd: '/r', exitCode: 0,
      stdout: huge, stderr: huge,
      durationMs: 1, startedAt: 1,
    });
    const cmd = store.getSnapshot()[0].commands[0];
    expect(cmd.stdout.length).toBeLessThan(huge.length);
    expect(cmd.stdout).toContain('[truncated');
    expect(cmd.stderr).toContain('[truncated');
  });

  it('getSnapshot returns a fresh array (not the internal one)', () => {
    store.start('op', '/r');
    const a = store.getSnapshot();
    const b = store.getSnapshot();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
