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
/** Пункты корня (без заголовка и разделителей). */
function rootItems(items: SgContextMenuItem[]): LabeledItem[] {
  return items.filter((i): i is LabeledItem => 'label' in i && !!i.label && !('header' in i && i.header));
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

  it('пояснение — во всплывающей подсказке', () => {
    const loc = t();
    const { items } = build(makeCommit(), { onCompareTo: vi.fn() });
    const item = byLabel(items, loc.contextMenu.compareToLocal);
    expect(item!.title).toBe(loc.contextMenu.help.compareToLocal);
  });
});

describe('getCommitMenuItems — cherry-pick / revert', () => {
  it('cherry-pick обычного коммита без mainline', () => {
    const loc = t();
    const commit = makeCommit();
    const { items } = build(commit);
    byLabel(items, loc.commitMenu.cherryPick)!.action!();
    expect(postCommand).toHaveBeenCalledWith({ type: 'cherryPick', hash: commit.hash });
  });

  it('cherry-pick merge-коммита передаёт mainline=1', () => {
    const loc = t();
    const commit = makeCommit({ parents: ['p1', 'p2'] });
    const { items } = build(commit);
    byLabel(items, loc.commitMenu.cherryPick)!.action!();
    expect(postCommand).toHaveBeenCalledWith({ type: 'cherryPick', hash: commit.hash, mainline: 1 });
  });

  it('revert merge-коммита передаёт mainline=1', () => {
    const loc = t();
    const commit = makeCommit({ parents: ['p1', 'p2'] });
    const { items } = build(commit);
    byLabel(items, loc.commitMenu.revert)!.action!();
    expect(postCommand).toHaveBeenCalledWith({ type: 'revert', hash: commit.hash, mainline: 1 });
  });
});

describe('getCommitMenuItems — множественный cherry-pick', () => {
  it('показывает «Cherry-pick N коммитов», когда кликнутый коммит в мульти-выборе (>1)', () => {
    const loc = t();
    const commit = makeCommit({ hash: 'bbbbbbb' });
    const selected = ['aaaaaaa', 'bbbbbbb', 'ccccccc'];
    const onStart = vi.fn();
    const items = getCommitMenuItems(
      commit, 'main', vi.fn(), vi.fn(), undefined, undefined, false, selected, onStart,
    );

    const item = byLabel(items, tpl(loc.contextMenu.cherryPickMany, { count: 3 }));
    expect(item).toBeTruthy();
    item!.action!();
    expect(onStart).toHaveBeenCalledOnce();
    expect(postCommand).toHaveBeenCalledWith({ type: 'cherryPickMany', hashes: selected });
    // Одиночного пункта при этом быть не должно.
    expect(byLabel(items, loc.commitMenu.cherryPick)).toBeUndefined();
  });

  it('остаётся одиночным, если кликнутый коммит вне мульти-выбора', () => {
    const loc = t();
    const commit = makeCommit({ hash: 'zzzzzzz' });
    const items = getCommitMenuItems(commit, 'main', vi.fn(), vi.fn(), undefined, undefined, false, ['aaaaaaa', 'bbbbbbb']);
    expect(byLabel(items, loc.commitMenu.cherryPick)).toBeTruthy();
    expect(byLabel(items, tpl(loc.contextMenu.cherryPickMany, { count: 2 }))).toBeUndefined();
  });

  it('остаётся одиночным при выборе из одного коммита', () => {
    const loc = t();
    const commit = makeCommit({ hash: 'aaaaaaa' });
    const items = getCommitMenuItems(commit, 'main', vi.fn(), vi.fn(), undefined, undefined, false, ['aaaaaaa']);
    expect(byLabel(items, loc.commitMenu.cherryPick)).toBeTruthy();
  });
});

describe('getCommitMenuItems — reset submenu', () => {
  it('soft/mixed вызывают resetTo сразу, hard — через подтверждение', () => {
    const loc = t();
    const commit = makeCommit();
    const { items, showPrompt } = build(commit);
    const resetParent = byLabel(items, loc.commitMenu.resetHere);
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
    const item = byLabel(items, loc.commitMenu.rebaseInteractive);
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(onRebase).toHaveBeenCalledWith(commit.hash);
  });

  it('задизейблен, когда onRebase не передан', () => {
    const loc = t();
    const { items } = build(makeCommit(), {});
    expect(byLabel(items, loc.commitMenu.rebaseInteractive)!.disabled).toBe(true);
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

  it('«Копировать сообщение» копирует тему коммита', () => {
    const loc = t();
    const commit = makeCommit();
    const { items } = build(commit);
    byLabel(items, loc.commitMenu.copyMessage)!.action!();
    expect(copyToClipboard).toHaveBeenCalledWith(commit.subject);
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

describe('getCommitMenuItems — структура (лаконичное меню)', () => {
  it('заголовок — короткий хеш и тема, без действия', () => {
    const commit = makeCommit();
    const { items } = build(commit);
    expect(items[0]).toMatchObject({ header: true, label: `${commit.hash.slice(0, 7)} · ${commit.subject}` });
    expect((items[0] as { action?: unknown }).action).toBeUndefined();
  });

  it('частое — в корне; изменение текущей ветки — в «В «main»»; редкое — в «Ещё»', () => {
    const loc = t();
    const { items } = build(makeCommit(), { onRebase: noop, onCompareTo: vi.fn() });
    const root = rootItems(items);
    const rootLabels = root.map((i) => i.label);
    for (const l of [loc.contextMenu.copySha, loc.commitMenu.cherryPick, loc.commitMenu.revert, loc.commitMenu.checkout]) {
      expect(rootLabels).toContain(l);
    }

    const onBranch = root.find((i) => i.label === tpl(loc.commitMenu.onBranch, { branch: 'main' }));
    const branchSub = labeled(onBranch!.submenu!).map((i) => i.label);
    expect(branchSub).toEqual(expect.arrayContaining([
      loc.commitMenu.mergeHere, loc.commitMenu.rebaseHere, loc.commitMenu.rebaseInteractive, loc.commitMenu.resetHere,
    ]));
    // Меняющее текущую ветку не торчит в корне.
    expect(rootLabels).not.toContain(loc.commitMenu.resetHere);
    expect(rootLabels).not.toContain(loc.commitMenu.mergeHere);

    const more = root.find((i) => i.label === loc.commitMenu.more);
    expect(labeled(more!.submenu!).map((i) => i.label)).toEqual(expect.arrayContaining([
      loc.contextMenu.newAnnotatedTag, loc.contextMenu.saveAsPatch, loc.contextMenu.compareToLocal, loc.contextMenu.copyCommitInfo,
    ]));
  });

  it('имя текущей ветки — один раз и коротким', () => {
    const items = getCommitMenuItems(makeCommit(), 'feature/SinkevichRN/MISP-298', vi.fn(), vi.fn());
    const all = labeled(items).map((i) => i.label);
    expect(all.filter((l) => l.includes('MISP-298'))).toHaveLength(1);
    expect(all.some((l) => l.includes('feature/SinkevichRN'))).toBe(false);
  });

  it('пояснения — во всплывающей подсказке, значков «!» (help) нет', () => {
    const loc = t();
    const commit = makeCommit({ refs: [{ name: 'main', type: 'head' }] });
    const { items } = build(commit, { onRebase: noop, onCompareTo: vi.fn() });
    const expectTitle = (label: string, help: string) => {
      const item = byLabel(items, label);
      expect(item, `нет пункта: ${label}`).toBeTruthy();
      expect(item!.title, `нет подсказки у: ${label}`).toBe(help);
    };
    expectTitle(loc.commitMenu.rebaseHere, loc.contextMenu.help.rebaseToHere);
    expectTitle(loc.commitMenu.rebaseInteractive, loc.contextMenu.help.interactiveRebaseToHere);
    expectTitle(loc.commitMenu.mergeHere, loc.contextMenu.help.mergeInto);
    expectTitle(loc.commitMenu.cherryPick, loc.contextMenu.help.cherryPick);
    expectTitle(loc.commitMenu.revert, loc.contextMenu.help.revert);
    expectTitle(loc.contextMenu.uncommitToStaging, loc.contextMenu.help.uncommitToStaging);
    expectTitle(loc.commitMenu.checkout, loc.contextMenu.help.checkoutCommit);
    expect(labeled(items).some((i) => !!i.help)).toBe(false);
  });
});

describe('getCommitMenuItems — где коммит: ветки, веб, PR', () => {
  const az = { host: 'azure' as const, base: 'https://tfs/C/P/_git/R' };

  it('«В каких ветках есть» зовёт onShowContaining', () => {
    const loc = t();
    const onShowContaining = vi.fn();
    const commit = makeCommit();
    const items = getCommitMenuItems(commit, 'main', vi.fn(), vi.fn(), undefined, undefined, false, undefined, undefined, { onShowContaining });
    byLabel(items, loc.commitMenu.containing)!.action!();
    expect(onShowContaining).toHaveBeenCalledWith(commit);
  });

  it('«Открыть в Azure DevOps» и «Открыть запрос на вытягивание N» у merge-коммита PR', () => {
    const loc = t();
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const commit = makeCommit({ subject: 'Объединенный запрос на вытягивание 12054: feat: x' });
    const items = getCommitMenuItems(commit, 'main', vi.fn(), vi.fn(), undefined, undefined, false, undefined, undefined, { webRepo: az });
    byLabel(items, tpl(loc.commitMenu.openWeb, { host: 'Azure DevOps' }))!.action!();
    expect(open).toHaveBeenCalledWith(`https://tfs/C/P/_git/R/commit/${commit.hash}`, '_blank');
    byLabel(items, tpl(loc.commitMenu.openPr, { id: '12054' }))!.action!();
    expect(open).toHaveBeenCalledWith('https://tfs/C/P/_git/R/pullrequest/12054', '_blank');
    vi.unstubAllGlobals();
  });

  it('без веб-адреса пунктов «Открыть…» нет; у обычного коммита нет пункта PR', () => {
    const loc = t();
    const webPrefix = loc.commitMenu.openWeb.split('{')[0];
    const prPrefix = loc.commitMenu.openPr.split('{')[0];
    const plain = getCommitMenuItems(makeCommit(), 'main', vi.fn(), vi.fn());
    expect(labeled(plain).some((i) => i.label.startsWith(webPrefix))).toBe(false);
    const withWeb = getCommitMenuItems(makeCommit(), 'main', vi.fn(), vi.fn(), undefined, undefined, false, undefined, undefined, { webRepo: az });
    expect(labeled(withWeb).some((i) => i.label.startsWith(prPrefix))).toBe(false);
  });

  it('локальная ветка на коммите — явный пункт «Переключить на …»', () => {
    const loc = t();
    const requestCheckout = vi.fn();
    const commit = makeCommit({ refs: [{ name: 'feature/x/task', type: 'branch' }] });
    const items = getCommitMenuItems(commit, 'main', vi.fn(), requestCheckout);
    byLabel(items, tpl(loc.contextMenu.checkout, { branch: 'task' }))!.action!();
    expect(requestCheckout).toHaveBeenCalledWith('feature/x/task');
  });
});
