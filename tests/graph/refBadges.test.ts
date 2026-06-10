import { describe, it, expect } from 'vitest';
import { buildRefBadges } from '../../src/renderer/src/features/graph/refBadges';
import type { RefInfo } from '../../src/core/git/types';

const remotes = ['origin', 'tfs'];

describe('buildRefBadges', () => {
  it('сливает локальную ветку с remote-tracking двойником в один бейдж', () => {
    const refs: RefInfo[] = [
      { name: 'feature/x', type: 'branch' },
      { name: 'origin/feature/x', type: 'remote' },
    ];
    const badges = buildRefBadges(refs, remotes, 'main');
    expect(badges).toHaveLength(1);
    expect(badges[0].label).toBe('feature/x');
    expect(badges[0].hasLocal).toBe(true);
    expect(badges[0].remotes).toEqual(['origin']);
    expect(badges[0].fullNames).toContain('feature/x');
    expect(badges[0].fullNames).toContain('origin/feature/x');
  });

  it('сливает HEAD-ветку с несколькими remote и помечает как текущую', () => {
    const refs: RefInfo[] = [
      { name: 'main', type: 'head' },
      { name: 'origin/main', type: 'remote' },
      { name: 'tfs/main', type: 'remote' },
    ];
    const badges = buildRefBadges(refs, remotes, 'main');
    expect(badges).toHaveLength(1);
    expect(badges[0].isCurrent).toBe(true);
    expect(badges[0].label).toBe('main');
    expect(badges[0].remotes.sort()).toEqual(['origin', 'tfs']);
  });

  it('remote-only ветка остаётся отдельной плашкой с полным именем', () => {
    const refs: RefInfo[] = [
      { name: 'origin/release', type: 'remote' },
    ];
    const badges = buildRefBadges(refs, remotes, 'main');
    expect(badges).toHaveLength(1);
    expect(badges[0].kind).toBe('remote');
    expect(badges[0].label).toBe('origin/release');
    expect(badges[0].hasLocal).toBe(false);
  });

  it('теги не сливаются с ветками', () => {
    const refs: RefInfo[] = [
      { name: 'main', type: 'head' },
      { name: 'origin/main', type: 'remote' },
      { name: 'v1.0', type: 'tag' },
    ];
    const badges = buildRefBadges(refs, remotes, 'main');
    expect(badges).toHaveLength(2);
    const tag = badges.find(b => b.kind === 'tag');
    expect(tag?.label).toBe('v1.0');
  });

  it('не путает имя ветки со слэшами и имя remote', () => {
    const refs: RefInfo[] = [
      { name: 'tfs/feature/login', type: 'branch' },
      { name: 'origin/tfs/feature/login', type: 'remote' },
    ];
    const badges = buildRefBadges(refs, remotes, 'main');
    expect(badges).toHaveLength(1);
    expect(badges[0].label).toBe('tfs/feature/login');
    expect(badges[0].remotes).toEqual(['origin']);
  });

  it('текущая ветка идёт первой', () => {
    const refs: RefInfo[] = [
      { name: 'develop', type: 'branch' },
      { name: 'main', type: 'head' },
    ];
    const badges = buildRefBadges(refs, remotes, 'main');
    expect(badges[0].label).toBe('main');
    expect(badges[0].isCurrent).toBe(true);
  });

  it('detached HEAD — отдельная плашка HEAD', () => {
    const refs: RefInfo[] = [
      { name: 'HEAD', type: 'head' },
    ];
    const badges = buildRefBadges(refs, remotes, '');
    expect(badges).toHaveLength(1);
    expect(badges[0].label).toBe('HEAD');
    expect(badges[0].isCurrent).toBe(true);
  });
});
