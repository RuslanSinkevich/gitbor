import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Тесты на recentRepos.ts — рендерный модуль, который пишет в localStorage.
 * Окружение vitest = node, поэтому подсовываем in-memory localStorage через
 * vi.stubGlobal (как в tests/i18n/tpl.test.ts).
 *
 * Сценарии:
 * - removeRecentRepo: удаляет запись, no-op на отсутствии, no-op на пустом сторе.
 * - addRecentRepo: дедуп по path (та же запись с обновлённым name переезжает наверх).
 * - addRecentRepo: лимит MAX_RECENT (=20) — старые отбрасываются.
 * - lastActive cleanup: clearLastActiveRepo + removeRecentRepo чистят оба ключа.
 *   Имитирует код в App.tsx, где invokeCommand({openRepo,path}) reject'ится →
 *   вызываем эти две функции для очистки stale recents.
 */

const memStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memStore.set(k, v);
  },
  removeItem: (k: string) => {
    memStore.delete(k);
  },
  clear: () => memStore.clear(),
  key: (i: number) => Array.from(memStore.keys())[i] ?? null,
  get length() {
    return memStore.size;
  },
});

const {
  addRecentRepo,
  removeRecentRepo,
  loadRecent,
  loadLastActiveRepo,
  saveLastActiveRepo,
  clearLastActiveRepo,
} = await import('../../src/renderer/src/features/repo-manager/recentRepos');

beforeEach(() => {
  memStore.clear();
});

describe('recentRepos.removeRecentRepo', () => {
  it('удаляет запись с заданным path', () => {
    addRecentRepo('a', '/a');
    addRecentRepo('b', '/b');
    const left = removeRecentRepo('/a');
    expect(left.map((r) => r.path)).toEqual(['/b']);
    expect(loadRecent().map((r) => r.path)).toEqual(['/b']);
  });

  it('no-op на отсутствующем path (не падает, не меняет стор)', () => {
    addRecentRepo('a', '/a');
    expect(() => removeRecentRepo('/missing')).not.toThrow();
    expect(loadRecent().map((r) => r.path)).toEqual(['/a']);
  });

  it('no-op на пустом сторе', () => {
    expect(() => removeRecentRepo('/x')).not.toThrow();
    expect(removeRecentRepo('/x')).toEqual([]);
    expect(loadRecent()).toEqual([]);
  });

  it('возвращает обновлённый список (не мутирует прошлый)', () => {
    addRecentRepo('a', '/a');
    addRecentRepo('b', '/b');
    addRecentRepo('c', '/c');
    const after = removeRecentRepo('/b');
    expect(after.map((r) => r.path)).toEqual(['/c', '/a']);
  });
});

describe('recentRepos.addRecentRepo', () => {
  it('дедуп по path: повторное добавление того же path → одна запись', () => {
    addRecentRepo('foo', '/p');
    addRecentRepo('bar', '/q');
    addRecentRepo('foo-renamed', '/p');
    const list = loadRecent();
    expect(list.length).toBe(2);
    expect(list[0].path).toBe('/p');
    expect(list[0].name).toBe('foo-renamed');
    expect(list[1].path).toBe('/q');
  });

  it('последняя добавленная запись — первая в списке (LRU)', () => {
    addRecentRepo('a', '/a');
    addRecentRepo('b', '/b');
    addRecentRepo('c', '/c');
    expect(loadRecent().map((r) => r.path)).toEqual(['/c', '/b', '/a']);
  });

  it('лимит MAX_RECENT = 20: добавление 25 → остаётся 20 самых свежих', () => {
    for (let i = 0; i < 25; i++) addRecentRepo(`r${i}`, `/repo/${i}`);
    const list = loadRecent();
    expect(list.length).toBe(20);
    expect(list[0].path).toBe('/repo/24');
    expect(list[19].path).toBe('/repo/5');
    expect(list.find((r) => r.path === '/repo/0')).toBeUndefined();
    expect(list.find((r) => r.path === '/repo/4')).toBeUndefined();
  });
});

describe('recentRepos.loadLastActiveRepo / clearLastActiveRepo', () => {
  it('loadLastActiveRepo возвращает null если ничего не сохранено', () => {
    expect(loadLastActiveRepo()).toBeNull();
  });

  it('saveLastActiveRepo + loadLastActiveRepo round-trip', () => {
    saveLastActiveRepo('/some/path');
    expect(loadLastActiveRepo()).toBe('/some/path');
  });

  it('clearLastActiveRepo обнуляет ключ', () => {
    saveLastActiveRepo('/some/path');
    clearLastActiveRepo();
    expect(loadLastActiveRepo()).toBeNull();
  });
});

describe('recentRepos: cleanup pattern (App.tsx, openRepo reject)', () => {
  it('clearLastActiveRepo + removeRecentRepo чистят и last active, и recents', () => {
    addRecentRepo('a', '/dead/path');
    addRecentRepo('b', '/alive/path');
    saveLastActiveRepo('/dead/path');
    expect(loadLastActiveRepo()).toBe('/dead/path');
    expect(loadRecent().map((r) => r.path)).toContain('/dead/path');

    // Сценарий из App.tsx: invokeCommand({openRepo, path: '/dead/path'}) reject'ится
    // → чистим обе сторы, чтобы при следующем старте не пытались опять открыть.
    clearLastActiveRepo();
    removeRecentRepo('/dead/path');

    expect(loadLastActiveRepo()).toBeNull();
    expect(loadRecent().map((r) => r.path)).toEqual(['/alive/path']);
  });

  it('removeRecentRepo не трогает другие записи', () => {
    addRecentRepo('a', '/a');
    addRecentRepo('b', '/b');
    addRecentRepo('c', '/c');
    removeRecentRepo('/b');
    const list = loadRecent();
    expect(list.map((r) => r.path).sort()).toEqual(['/a', '/c']);
  });
});
