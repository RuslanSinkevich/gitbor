import { describe, it, expect } from 'vitest';
import { applyGraphFilter } from '../../src/renderer/src/hooks/useGraphFilter';
import type { Commit, Branch } from '../../src/core/git/types';

function c(hash: string, parents: string[] = []): Commit {
  return {
    hash,
    parents,
    authorName: 'a',
    authorEmail: 'a@x',
    authorDate: 0,
    refs: [],
    subject: hash,
    isRemoteOnly: false,
  };
}

function b(name: string, hash: string, opts: Partial<Branch> = {}): Branch {
  return {
    name,
    hash,
    isCurrent: false,
    isRemote: false,
    ...opts,
  };
}

/* Toy repo (cовременные коммиты сверху, parents смотрят вниз/назад):
 *
 *   feature: f2 → f1 → m1
 *                       \
 *   main:          m2 → m1 → m0
 */
const commits: Commit[] = [
  c('f2', ['f1']),
  c('m2', ['m1']),
  c('f1', ['m1']),
  c('m1', ['m0']),
  c('m0', []),
];

const branches: Branch[] = [
  b('main', 'm2'),
  b('feature', 'f2'),
  b('origin/main', 'm2', { isRemote: true }),
];

describe('applyGraphFilter', () => {
  it('returns commits as-is when no filter is active', () => {
    const r = applyGraphFilter(commits, branches, null, new Set());
    expect(r.mode).toBe('none');
    expect(r.totalKept).toBe(5);
    expect(r.totalAll).toBe(5);
    expect(r.commits.map(x => x.hash)).toEqual(['f2', 'm2', 'f1', 'm1', 'm0']);
  });

  it('solo: keeps only commits reachable from the chosen branch tip', () => {
    const r = applyGraphFilter(commits, branches, 'feature', new Set());
    expect(r.mode).toBe('solo');
    expect(r.commits.map(x => x.hash).sort()).toEqual(['f1', 'f2', 'm0', 'm1']);
    expect(r.totalKept).toBe(4);
    expect(r.totalAll).toBe(5);
  });

  it('solo: falls back to full list when branch was deleted', () => {
    const r = applyGraphFilter(commits, branches, 'gone-branch', new Set());
    expect(r.mode).toBe('none');
    expect(r.totalKept).toBe(5);
  });

  it('hide: removes commits unreachable from any non-hidden local branch', () => {
    const r = applyGraphFilter(commits, branches, null, new Set(['feature']));
    expect(r.mode).toBe('hide');
    // feature-only commits (f1, f2) gone; main-side (m0..m2) remain.
    expect(r.commits.map(x => x.hash).sort()).toEqual(['m0', 'm1', 'm2']);
  });

  it('hide: returns empty graph when every local branch is hidden', () => {
    const r = applyGraphFilter(commits, branches, null, new Set(['main', 'feature']));
    expect(r.mode).toBe('hide');
    expect(r.commits).toHaveLength(0);
    expect(r.totalKept).toBe(0);
    expect(r.totalAll).toBe(5);
  });

  it('hide: ignores remote branches when computing visible tips', () => {
    // Hiding `main` leaves only `feature` as visible local — `origin/main`
    // must NOT keep main-only commits visible (we hide branches, not refs).
    const r = applyGraphFilter(commits, branches, null, new Set(['main']));
    expect(r.mode).toBe('hide');
    // m2 is reachable ONLY through main tip; should disappear.
    expect(r.commits.map(x => x.hash).sort()).toEqual(['f1', 'f2', 'm0', 'm1']);
  });

  it('solo wins over hide', () => {
    // soloBranch=feature even when feature is also in hidden set: solo wins.
    const r = applyGraphFilter(commits, branches, 'feature', new Set(['feature', 'main']));
    expect(r.mode).toBe('solo');
    expect(r.commits.map(x => x.hash).sort()).toEqual(['f1', 'f2', 'm0', 'm1']);
  });
});
