import { describe, it, expect, vi } from 'vitest';
import { getBranchMenuItems, type BranchCompare } from '../../src/renderer/src/features/sidebar/sidebarMenuItems';
import type { SgContextMenuItem } from '../../src/renderer/src/ui/SgContextMenu';
import type { Branch } from '../../src/renderer/src/types';
import { t, tpl } from '../../src/renderer/src/i18n';

vi.mock('../../src/renderer/src/api', () => ({
  postCommand: vi.fn(),
  copyToClipboard: vi.fn(),
}));

const LONG = 'feature/SedakovIV/CL_Departments_n_Positions';

function branch(partial: Partial<Branch> & { name: string }): Branch {
  return { hash: 'abc', isCurrent: false, isRemote: false, ...partial };
}

const labels = (items: SgContextMenuItem[]) =>
  items.filter(i => !i.divider).map(i => i.label as string);

/** Лаконичное меню: имя один раз в заголовке, опасное — в конце. */
describe('getBranchMenuItems', () => {
  const loc = t();
  const m = loc.contextMenu.branchMenu;
  const noop = vi.fn();

  const build = (b: Branch, marks: string[] = [], over: Partial<BranchCompare> = {}) => getBranchMenuItems(
    b, 'feature/SinkevichRN/MISP-298', loc, noop, noop, noop,
    { onToggleSolo: noop, onToggleHide: noop, onTogglePin: noop, onShowInfo: noop },
    ['origin'], { run: noop, marks, toggleMark: noop, markFirst: noop, clearMarks: noop, ...over },
  );
  const compareInto = tpl(m.compareInto, { target: 'MISP-298' });
  const sub = (items: SgContextMenuItem[]) => {
    const c = items.find(i => i.label === m.compare);
    return c && 'submenu' in c ? c.submenu ?? [] : [];
  };

  it('заголовок — короткое имя, полное — в подсказке', () => {
    const items = build(branch({ name: LONG }));
    expect(items[0]).toMatchObject({ header: true, label: 'CL_Departments_n_Positions', title: LONG });
  });

  it('имя ветки не повторяется в пунктах', () => {
    const items = build(branch({ name: LONG }));
    const rest = labels(items.slice(1));
    expect(rest.some(l => l.includes('CL_Departments_n_Positions'))).toBe(false);
  });

  it('«Сравнить ▸»: что принесёт в текущую и «Выбрать для сравнения»', () => {
    const run = vi.fn();
    const markFirst = vi.fn();
    const s = sub(build(branch({ name: LONG }), [], { run, markFirst }));
    expect(labels(s)).toEqual([compareInto, m.compareMark]);
    s[0]?.action?.();
    expect(run).toHaveBeenCalledWith(LONG, 'feature/SinkevichRN/MISP-298');
    s[1]?.action?.();
    expect(markFirst).toHaveBeenCalledWith(LONG);
  });

  it('ветка 1 выбрана: у других — «Что принесёт в «1»», у самой — «Снять выбор»', () => {
    const run = vi.fn();
    const s = sub(build(branch({ name: 'release/2.4' }), ['feature/a'], { run }));
    const intoMarked = tpl(m.compareIntoMarked, { target: 'a' });
    expect(labels(s)).toEqual([compareInto, intoMarked]);
    s.find(i => i.label === intoMarked)?.action?.();
    expect(run).toHaveBeenCalledWith('release/2.4', 'feature/a');
    expect(labels(sub(build(branch({ name: 'feature/a' }), ['feature/a'])))).toContain(m.compareUnmark);
  });

  it('пара Ctrl+кликом: 1 — куда, 2 — что, «2 → 1» у обеих веток', () => {
    const marks = ['feature/a', 'release/2.4'];
    const pair = tpl(m.comparePair, { from: '2.4', to: 'a' });
    for (const name of marks) {
      const run = vi.fn();
      sub(build(branch({ name }), marks, { run })).find(i => i.label === pair)?.action?.();
      expect(run).toHaveBeenCalledWith('release/2.4', 'feature/a');
    }
  });

  it('«Удалить» — последний пункт, «Переименовать» — перед ним', () => {
    const l = labels(build(branch({ name: LONG })));
    expect(l[l.length - 1]).toBe(m.delete);
    expect(l[l.length - 2]).toBe(m.rename);
  });

  it('текущая ветка: нет переключения, слияния, сравнения и удаления', () => {
    const l = labels(build(branch({ name: 'feature/SinkevichRN/MISP-298', isCurrent: true })));
    for (const x of [m.checkout, m.delete, m.fetch]) expect(l).not.toContain(x);
    expect(labels(sub(build(branch({ name: 'feature/SinkevichRN/MISP-298', isCurrent: true }))))).not.toContain(compareInto);
    expect(l.some(x => x.startsWith(m.mergeInto.split('«')[0]))).toBe(false);
    expect(l).toContain(m.rename);
  });

  it('remote-ветка: «отслеживать», без переименования/удаления/fetch', () => {
    const l = labels(build(branch({ name: 'origin/' + LONG, isRemote: true })));
    expect(l).toContain(m.track);
    for (const x of [m.rename, m.delete, m.fetch, m.checkout]) expect(l).not.toContain(x);
  });
});
