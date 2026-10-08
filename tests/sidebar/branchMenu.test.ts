import { describe, it, expect, vi } from 'vitest';
import { getBranchMenuItems } from '../../src/renderer/src/features/sidebar/sidebarMenuItems';
import type { SgContextMenuItem } from '../../src/renderer/src/ui/SgContextMenu';
import type { Branch } from '../../src/renderer/src/types';
import { t } from '../../src/renderer/src/i18n';

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

  const build = (b: Branch) => getBranchMenuItems(
    b, 'feature/SinkevichRN/MISP-298', loc, noop, noop, noop,
    { onToggleSolo: noop, onToggleHide: noop, onTogglePin: noop, onShowInfo: noop },
    ['origin'], noop,
  );

  it('заголовок — короткое имя, полное — в подсказке', () => {
    const items = build(branch({ name: LONG }));
    expect(items[0]).toMatchObject({ header: true, label: 'CL_Departments_n_Positions', title: LONG });
  });

  it('имя ветки не повторяется в пунктах', () => {
    const items = build(branch({ name: LONG }));
    const rest = labels(items.slice(1));
    expect(rest.some(l => l.includes('CL_Departments_n_Positions'))).toBe(false);
  });

  it('сравнение — подменю с двумя направлениями к текущей ветке', () => {
    const items = build(branch({ name: LONG }));
    const compare = items.find(i => i.label === m.compare);
    expect(compare && 'submenu' in compare ? compare.submenu?.length : 0).toBe(2);
  });

  it('«Удалить» — последний пункт, «Переименовать» — перед ним', () => {
    const l = labels(build(branch({ name: LONG })));
    expect(l[l.length - 1]).toBe(m.delete);
    expect(l[l.length - 2]).toBe(m.rename);
  });

  it('текущая ветка: нет переключения, слияния, сравнения и удаления', () => {
    const l = labels(build(branch({ name: 'feature/SinkevichRN/MISP-298', isCurrent: true })));
    for (const x of [m.checkout, m.compare, m.delete, m.fetch]) expect(l).not.toContain(x);
    expect(l.some(x => x.startsWith(m.mergeInto.split('«')[0]))).toBe(false);
    expect(l).toContain(m.rename);
  });

  it('remote-ветка: «отслеживать», без переименования/удаления/fetch', () => {
    const l = labels(build(branch({ name: 'origin/' + LONG, isRemote: true })));
    expect(l).toContain(m.track);
    for (const x of [m.rename, m.delete, m.fetch, m.checkout]) expect(l).not.toContain(x);
  });
});
