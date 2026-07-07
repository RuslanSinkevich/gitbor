import { describe, it, expect, vi, beforeEach } from 'vitest';

// api дергает window.gitBorAPI / navigator.clipboard — в node-окружении их нет,
// поэтому мокаем модуль целиком и проверяем аргументы вызовов.
const postCommand = vi.fn();
const copyToClipboard = vi.fn();
vi.mock('../../src/renderer/src/api', () => ({
  postCommand: (...args: unknown[]) => postCommand(...args),
  copyToClipboard: (...args: unknown[]) => copyToClipboard(...args),
}));

import { getCommitMenuItems } from '../../src/renderer/src/features/graph/commitMenuItems';
import { t, tpl } from '../../src/renderer/src/i18n';
import type { Commit } from '../../src/renderer/src/types';
import type { SgContextMenuItem } from '../../src/renderer/src/ui/SgContextMenu';

function makeCommit(over: Partial<Commit> = {}): Commit {
  return {
    hash: 'aaaaaaa1111111111111111111111111111111111',
    parents: ['ppppppp0000000000000000000000000000000000'],
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: 1_700_000_000_000,
    refs: [],
    subject: 'do a thing',
    isRemoteOnly: false,
    ...over,
  };
}

/** Только пункты с меткой (без разделителей/заголовков), рекурсивно с submenu. */
type LabeledItem = Extract<SgContextMenuItem, { label: string }>;
function labeled(items: SgContextMenuItem[]): LabeledItem[] {
  const out: LabeledItem[] = [];
  for (const i of items) {
    if ('label' in i && !!i.label && !('header' in i && i.header)) out.push(i as LabeledItem);
    if ('submenu' in i && i.submenu) out.push(...labeled(i.submenu));
  }
  return out;
}
function byLabel(items: SgContextMenuItem[], label: string): LabeledItem | undefined {
  return labeled(items).find((i) => i.label === label);
}

const noop = () => {};

/** Полный набор коллбэков; при необходимости переопределяем в тесте. */
function build(commit: Commit, opts: {
  onRebase?: (onto: string) => void;
  onCompareTo?: (from: string, to: string) => void;
  headOnRemote?: boolean;
} = {}) {
  const showPrompt = vi.fn();
  const requestCheckout = vi.fn();
  const items = getCommitMenuItems(
    commit, 'main', showPrompt, requestCheckout,
    opts.onRebase, opts.onCompareTo,
    opts.headOnRemote ?? false,
  );
  return { items, showPrompt, requestCheckout };
}

beforeEach(() => {
  postCommand.mockClear();
  copyToClipboard.mockClear();
});

describe('getCommitMenuItems — «Сравнить с локальными»', () => {
  it('маршрутизируется через onCompareTo(commit, WORKING), а не через openDiff', () => {
    const loc = t();
    const onCompareTo = vi.fn();
    const commit = makeCommit();
    const { items } = build(commit, { onCompareTo });

    const item = byLabel(items, loc.contextMenu.compareToLocal);
    expect(item).toBeTruthy();
    item!.action!();

    expect(onCompareTo).toHaveBeenCalledWith(commit.hash, 'WORKING');
    // Никакого «мусорного» openDiff с file '.' быть не должно.
    expect(postCommand).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'openDiff' }));
  });

  it('скрыт, когда сравнение недоступно (onCompareTo не передан)', () => {
    const loc = t();
    const { items } = build(makeCommit(), {});
    expect(byLabel(items, loc.contextMenu.compareToLocal)).toBeUndefined();
  });

  it('имеет пояснение (help)', () => {
    const loc = t();
    const { items } = build(makeCommit(), { onCompareTo: vi.fn() });
    const item = byLabel(items, loc.contextMenu.compareToLocal);
    expect(item!.help).toBe(loc.contextMenu.help.compareToLocal);
  });
});

describe('getCommitMenuItems — cherry-pick / revert', () => {
  it('cherry-pick обычного коммита без mainline', () => {
    const loc = t();
    const commit = makeCommit();
    const { items } = build(commit);
    byLabel(items, loc.contextMenu.cherryPick)!.action!();
    expect(postCommand).toHaveBeenCalledWith({ type: 'cherryPick', hash: commit.hash });
  });

  it('cherry-pick merge-коммита передаёт mainline=1', () => {
    const loc = t();
    const commit = makeCommit({ parents: ['p1', 'p2'] });
    const { items } = build(commit);
    byLabel(items, loc.contextMenu.cherryPick)!.action!();
    expect(postCommand).toHaveBeenCalledWith({ type: 'cherryPick', hash: commit.hash, mainline: 1 });
  });

  it('revert merge-коммита передаёт mainline=1', () => {
    const loc = t();
    const commit = makeCommit({ parents: ['p1', 'p2'] });
    const { items } = build(commit);
    byLabel(items, loc.contextMenu.revert)!.action!();
    expect(postCommand).toHaveBeenCalledWith({ type: 'revert', hash: commit.hash, mainline: 1 });
  });
});

describe('getCommitMenuItems — множественный cherry-pick', () => {
  it('показывает «Cherry-pick N коммитов», когда кликнутый коммит в мульти-выборе (>1)', () => {
    const loc = t();
    const commit = makeCommit({ hash: 'bbbbbbb' });
    const selected = ['aaaaaaa', 'bbbbbbb', 'ccccccc'];
    const showPrompt = vi.fn();
    const requestCheckout = vi.fn();
    const items = getCommitMenuItems(commit, 'main', showPrompt, requestCheckout, undefined, undefined, false, selected);

    const label = tpl(loc.contextMenu.cherryPickMany, { count: 3 });
    const item = byLabel(items, label);
    expect(item).toBeTruthy();
    item!.action!();
    expect(postCommand).toHaveBeenCalledWith({ type: 'cherryPickMany', hashes: selected });
    // Одиночного пункта при этом быть не должно.
    expect(byLabel(items, loc.contextMenu.cherryPick)).toBeUndefined();
  });

  it('остаётся одиночным, если кликнутый коммит вне мульти-выбора', () => {
    const loc = t();
    const commit = makeCommit({ hash: 'zzzzzzz' });
    const selected = ['aaaaaaa', 'bbbbbbb'];
    const showPrompt = vi.fn();
    const requestCheckout = vi.fn();
    const items = getCommitMenuItems(commit, 'main', showPrompt, requestCheckout, undefined, undefined, false, selected);

    expect(byLabel(items, loc.contextMenu.cherryPick)).toBeTruthy();
    expect(byLabel(items, tpl(loc.contextMenu.cherryPickMany, { count: 2 }))).toBeUndefined();
  });

  it('остаётся одиночным при выборе из одного коммита', () => {
    const loc = t();
    const commit = makeCommit({ hash: 'aaaaaaa' });
    const showPrompt = vi.fn();
    const requestCheckout = vi.fn();
    const items = getCommitMenuItems(commit, 'main', showPrompt, requestCheckout, undefined, undefined, false, ['aaaaaaa']);
    expect(byLabel(items, loc.contextMenu.cherryPick)).toBeTruthy();
  });
});

describe('getCommitMenuItems — reset submenu', () => {
  it('soft/mixed вызывают resetTo сразу, hard — через подтверждение', () => {
    const loc = t();
    const commit = makeCommit();
    const { items, showPrompt } = build(commit);
    const resetParent = labeled(items).find((i) => i.label === tpl(loc.contextMenu.resetToHere, { branch: 'main' }));
    expect(resetParent?.submenu).toBeTruthy();
    const sub = resetParent!.submenu!;

    byLabel(sub, loc.contextMenu.resetSoft)!.action!();
    expect(postCommand).toHaveBeenCalledWith({ type: 'resetTo', hash: commit.hash, mode: 'soft' });

    byLabel(sub, loc.contextMenu.resetMixed)!.action!();
    expect(postCommand).toHaveBeenCalledWith({ type: 'resetTo', hash: commit.hash, mode: 'mixed' });

    // Hard — деструктивно: должно уйти в showPrompt, а не сразу в postCommand.
    postCommand.mockClear();
    byLabel(sub, loc.contextMenu.resetHard)!.action!();
    expect(postCommand).not.toHaveBeenCalled();
    expect(showPrompt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'confirm', danger: true }));
  });
});

describe('getCommitMenuItems — «Вернуть коммит в подготовленные» (uncommit)', () => {
  it('виден только для HEAD с родителем и не на remote', () => {
    const loc = t();
    const head = makeCommit({ refs: [{ name: 'main', type: 'head' }] });
    const { items } = build(head, {});
    expect(byLabel(items, loc.contextMenu.uncommitToStaging)).toBeTruthy();
  });

  it('скрыт, если HEAD уже на remote', () => {
    const loc = t();
    const head = makeCommit({ refs: [{ name: 'main', type: 'head' }] });
    const { items } = build(head, { headOnRemote: true });
    expect(byLabel(items, loc.contextMenu.uncommitToStaging)).toBeUndefined();
  });

  it('скрыт для обычного (не-HEAD) коммита', () => {
    const loc = t();
    const { items } = build(makeCommit(), {});
    expect(byLabel(items, loc.contextMenu.uncommitToStaging)).toBeUndefined();
  });
});

describe('getCommitMenuItems — interactive rebase', () => {
  it('активен и зовёт onRebase, когда обработчик передан', () => {
    const loc = t();
    const onRebase = vi.fn();
    const commit = makeCommit();
    const { items } = build(commit, { onRebase });
    const item = byLabel(items, tpl(loc.contextMenu.interactiveRebaseToHere, { branch: 'main' }));
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(onRebase).toHaveBeenCalledWith(commit.hash);
  });

  it('задизейблен, когда onRebase не передан', () => {
    const loc = t();
    const { items } = build(makeCommit(), {});
    const item = byLabel(items, tpl(loc.contextMenu.interactiveRebaseToHere, { branch: 'main' }));
    expect(item!.disabled).toBe(true);
  });
});

describe('getCommitMenuItems — copy', () => {
  it('«Копировать SHA» копирует полный hash', () => {
    const loc = t();
    const commit = makeCommit();
    const { items } = build(commit);
    byLabel(items, loc.contextMenu.copySha)!.action!();
    expect(copyToClipboard).toHaveBeenCalledWith(commit.hash);
  });

  it('«Копировать информацию о коммите» включает hash, subject и автора', () => {
    const loc = t();
    const commit = makeCommit();
    const { items } = build(commit);
    byLabel(items, loc.contextMenu.copyCommitInfo)!.action!();
    const text = copyToClipboard.mock.calls[0][0] as string;
    expect(text).toContain(commit.hash.substring(0, 7));
    expect(text).toContain(commit.subject);
    expect(text).toContain(commit.authorName);
  });
});

describe('getCommitMenuItems — подменю «Дополнительно»', () => {
  it('редкие пункты вынесены в подменю, а частые остаются в корне', () => {
    const loc = t();
    const commit = makeCommit();
    const { items } = build(commit, { onRebase: noop, onCompareTo: vi.fn() });

    const more = items.find(
      (i): i is LabeledItem => 'label' in i && i.label === loc.contextMenu.more,
    );
    expect(more?.submenu).toBeTruthy();
    const subLabels = labeled(more!.submenu!).map((i) => i.label);

    expect(subLabels).toContain(loc.contextMenu.newAnnotatedTag);
    expect(subLabels).toContain(tpl(loc.contextMenu.interactiveRebaseToHere, { branch: 'main' }));
    expect(subLabels).toContain(loc.contextMenu.saveAsPatch);
    expect(subLabels).toContain(loc.contextMenu.compareToLocal);
    expect(subLabels).toContain(loc.contextMenu.copyCommitInfo);

    // Частые остаются в корне (не внутри «Дополнительно»).
    const rootLabels = items
      .filter((i): i is LabeledItem => 'label' in i && !!i.label && i.label !== loc.contextMenu.more)
      .map((i) => i.label);
    expect(rootLabels).toContain(loc.contextMenu.cherryPick);
    expect(rootLabels).toContain(loc.contextMenu.checkoutCommit);
    expect(rootLabels).toContain(loc.contextMenu.copySha);
    expect(rootLabels).toContain(tpl(loc.contextMenu.rebaseToHere, { branch: 'main' }));
  });
});

describe('getCommitMenuItems — пояснения (help) на неочевидных пунктах', () => {
  it('ключевые опасные/непонятные пункты снабжены подсказкой', () => {
    const loc = t();
    const commit = makeCommit({ refs: [{ name: 'main', type: 'head' }] });
    const { items } = build(commit, { onRebase: noop, onCompareTo: vi.fn() });

    const expectHelp = (label: string, help: string) => {
      const item = byLabel(items, label);
      expect(item, `нет пункта: ${label}`).toBeTruthy();
      expect(item!.help, `нет help у: ${label}`).toBe(help);
    };

    expectHelp(tpl(loc.contextMenu.rebaseToHere, { branch: 'main' }), loc.contextMenu.help.rebaseToHere);
    expectHelp(tpl(loc.contextMenu.interactiveRebaseToHere, { branch: 'main' }), loc.contextMenu.help.interactiveRebaseToHere);
    expectHelp(tpl(loc.contextMenu.mergeInto, { source: commit.hash.substring(0, 7), target: 'main' }), loc.contextMenu.help.mergeInto);
    expectHelp(loc.contextMenu.cherryPick, loc.contextMenu.help.cherryPick);
    expectHelp(loc.contextMenu.revert, loc.contextMenu.help.revert);
    expectHelp(loc.contextMenu.uncommitToStaging, loc.contextMenu.help.uncommitToStaging);
    expectHelp(loc.contextMenu.checkoutCommit, loc.contextMenu.help.checkoutCommit);
    expectHelp(loc.contextMenu.saveAsPatch, loc.contextMenu.help.saveAsPatch);
    expectHelp(loc.contextMenu.compareToLocal, loc.contextMenu.help.compareToLocal);
  });
});
