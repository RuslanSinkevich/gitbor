import { tpl } from '../../i18n';
import { postCommand, copyToClipboard } from '../../api';
import type { Branch, Tag, Stash, Remote } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import type { ShowPrompt } from '../graph/commitMenuItems';
import type { RequestCheckout } from '../checkout';
import type { RequestApplyStash } from '../stash';

/**
 * Сравнение веток. Направление всегда явное, без угадывания «главной»:
 *  - быстрое — что ветка принесёт в текущую;
 *  - пара — две ветки, отмеченные Ctrl+кликом: 1 — что, 2 — куда.
 * Обратное направление — кнопкой ⇄ в окне сравнения.
 */
export interface BranchCompare {
  /** Что `branch` принесёт в `base` (дифф от merge-base). */
  run: (branch: string, base: string) => void;
  /** Ветки, отмеченные Ctrl+кликом, по порядку: [1, 2]. */
  marks: string[];
  /** Ctrl+клик: отметить ветку следующим номером или снять отметку. */
  toggleMark: (name: string) => void;
  /** «Выбрать для сравнения»: ветка становится единственной, под номером 1. */
  markFirst: (name: string) => void;
  clearMarks: () => void;
}

type Loc = ReturnType<typeof import('../../i18n').t>;

/** Короткое имя ветки/рефа — последний сегмент после `/` (для компактных
 *  пунктов меню). Полное имя кладём в `title` (тултип). */
function leaf(name: string): string {
  const i = name.lastIndexOf('/');
  return i >= 0 ? name.slice(i + 1) : name;
}

/**
 * Открыть диалог Track для remote-ветки: создать локальную ветку с tracking
 * и переключиться на неё. Общий код для контекстного меню и двойного клика
 * по remote-ветке в сайдбаре. Имя remote — первый сегмент (git-имена remote
 * не содержат `/`), дефолт локального имени — путь без `<remote>/`.
 */
export function promptTrackRemote(branch: Branch, loc: Loc, showPrompt: ShowPrompt): void {
  const slash = branch.name.indexOf('/');
  const remoteName = slash > 0 ? branch.name.slice(0, slash) : '';
  const remoteBranch = slash > 0 ? branch.name.slice(slash + 1) : branch.name;
  if (!remoteName) return;
  showPrompt({
    title: tpl(loc.contextMenu.trackRemoteTitle, { branch: branch.name }),
    label: loc.contextMenu.trackRemotePrompt,
    defaultValue: remoteBranch,
    placeholder: 'branch-name',
    onConfirm: (localName) => {
      const name = localName.trim();
      if (name) postCommand({ type: 'trackRemoteBranch', remote: remoteName, remoteBranch, localName: name });
    },
  });
}

/**
 * Обновить неактивную локальную ветку через `git fetch <remote> <b>:<b>`.
 * С upstream — сразу; без — модалка выбора remote (родителя), после успеха
 * ставим tracking, чтобы следующий раз не спрашивать.
 */
export function promptFetchBranch(
  branch: Branch,
  loc: Loc,
  showPrompt: ShowPrompt,
  remoteNames: string[],
): void {
  if (branch.upstream) {
    postCommand({ type: 'fetchBranch', branch: branch.name });
    return;
  }
  if (remoteNames.length === 0) {
    showPrompt({
      kind: 'confirm',
      title: tpl(loc.contextMenu.fetchBranchTitle, { branch: branch.name }),
      message: loc.contextMenu.fetchBranchNoRemotes,
      confirmLabel: loc.dialog.close,
      onConfirm: () => {},
    });
    return;
  }
  const defaultRemote = remoteNames.includes('origin') ? 'origin' : remoteNames[0];
  showPrompt({
    kind: 'select',
    title: tpl(loc.contextMenu.fetchBranchTitle, { branch: branch.name }),
    message: loc.contextMenu.fetchBranchPickRemote,
    label: loc.contextMenu.fetchBranchRemoteLabel,
    options: remoteNames.map((name) => ({ value: name, label: name })),
    defaultValue: defaultRemote,
    confirmLabel: loc.contextMenu.fetchBranch,
    onConfirm: (remote) => {
      if (!remote) return;
      postCommand({ type: 'fetchBranch', branch: branch.name, remote, setUpstream: true });
    },
  });
}

/**
 * Колбэки для Fork-style фич веток (pin / solo / hide / info).
 * Опциональные — старые вызывающие места работают без них (фичи просто
 * не появятся в меню). Когда передан колбэк — добавляем соответствующий
 * пункт в группу «Действия с графом» / «Сайдбар».
 */
export interface BranchExtrasMenu {
  isPinned?: boolean;
  isHidden?: boolean;
  isSolo?: boolean;
  onTogglePin?: () => void;
  onToggleHide?: () => void;
  onToggleSolo?: () => void;
  onClearSolo?: () => void;
  onShowInfo?: () => void;
  /** Перенести pin/hide/solo/notes на новое имя перед отправкой renameBranch. */
  onRename?: (oldName: string, newName: string) => void;
  onDelete?: () => void;
}

/**
 * Подменю «Сравнить»: быстрое — с текущей веткой, и пара веток, как в Fork.
 * Пара: «Выбрать для сравнения» даёт ветке номер 1, на второй ветке
 * появляется «1 → эта». То же быстрее — Ctrl+клик по двум веткам.
 */
function compareSubmenu(branch: Branch, currentBranch: string, loc: Loc, compare: BranchCompare): SgContextMenuItem[] {
  const m = loc.contextMenu.branchMenu;
  const help = loc.contextMenu.help;
  const short = leaf(branch.name);
  const cur = leaf(currentBranch) || 'HEAD';
  const { marks } = compare;
  const items: SgContextMenuItem[] = [];

  if (!branch.isCurrent) {
    items.push({
      label: tpl(m.compareInto, { target: cur }),
      title: tpl(help.compareIntoCurrent, { branch: short, target: cur }),
      action: () => compare.run(branch.name, currentBranch || 'HEAD'),
    });
  }

  const pairItem = (from: string, to: string): SgContextMenuItem => ({
    label: tpl(m.comparePair, { from: leaf(from), to: leaf(to) }),
    title: tpl(help.comparePair, { from, to }),
    action: () => compare.run(from, to),
  });
  const own = marks.indexOf(branch.name);
  if (marks.length === 2 && own >= 0) {
    items.push(pairItem(marks[0], marks[1]));
  } else if (marks.length >= 1 && own < 0) {
    // Ветка 1 уже выбрана — эта становится второй («куда»).
    items.push(pairItem(marks[0], branch.name));
  }
  if (own >= 0) {
    items.push({ label: m.compareUnmark, action: () => compare.clearMarks() });
  } else {
    items.push({ label: m.compareMark, title: help.compareMark, action: () => compare.markFirst(branch.name) });
  }
  return items;
}

/**
 * Меню ветки в сайдбаре. Имя ветки — один раз, в заголовке (полное — в
 * подсказке); в пунктах только глаголы, поэтому ширина меню не зависит от
 * длины имени. Группы по смыслу: перейти/обновить → слить/сравнить →
 * создать → вид в графе → переименовать/удалить (опасное — последним).
 */
export function getBranchMenuItems(
  branch: Branch, currentBranch: string, loc: Loc, showPrompt: ShowPrompt,
  requestCheckout: RequestCheckout, onMerge?: (source: string) => void,
  extras: BranchExtrasMenu = {},
  remoteNames: string[] = [],
  compare?: BranchCompare,
): SgContextMenuItem[] {
  const m = loc.contextMenu.branchMenu;
  const short = leaf(branch.name);
  const cur = leaf(currentBranch) || 'HEAD';
  const isLocal = !branch.isRemote;
  const other = !branch.isCurrent;

  const groups: SgContextMenuItem[][] = [];
  const header: SgContextMenuItem = { header: true, label: short, title: branch.name };

  // 1. Перейти / обновить
  const nav: SgContextMenuItem[] = [];
  if (other && isLocal) nav.push({ label: m.checkout, action: () => requestCheckout(branch.name) });
  if (branch.isRemote) nav.push({ label: m.track, title: tpl(loc.contextMenu.trackRemoteTitle, { branch: branch.name }), action: () => promptTrackRemote(branch, loc, showPrompt) });
  // `git fetch <remote> <b>:<b>` — только для неактивной локальной: активную тянут Pull'ом.
  if (other && isLocal) nav.push({ label: m.fetch, title: tpl(loc.contextMenu.fetchBranchTitle, { branch: branch.name }), action: () => promptFetchBranch(branch, loc, showPrompt, remoteNames) });
  groups.push(nav);

  // 2. Слить / сравнить (с текущей веткой; сравнение — от merge-base)
  const integrate: SgContextMenuItem[] = [];
  if (other) {
    integrate.push({
      label: tpl(m.mergeInto, { target: cur }),
      title: tpl(loc.contextMenu.mergeInto, { source: branch.name, target: currentBranch }),
      action: () => onMerge ? onMerge(branch.name) : postCommand({ type: 'merge', branch: branch.name }),
    });
  }
  if (compare) integrate.push({ label: m.compare, submenu: compareSubmenu(branch, currentBranch, loc, compare) });
  groups.push(integrate);

  // 3. Создать
  groups.push([
    {
      label: m.newBranch,
      action: () => showPrompt({
        title: tpl(loc.contextMenu.newBranch, { ref: branch.name }),
        placeholder: 'branch-name',
        onConfirm: (name) => postCommand({ type: 'createBranch', name, from: branch.name }),
      }),
    },
    {
      label: m.newTag,
      action: () => showPrompt({
        title: tpl(loc.contextMenu.newTag, { ref: branch.name }),
        placeholder: 'v1.0.0',
        onConfirm: (name) => postCommand({ type: 'createTag', name, ref: branch.name }),
      }),
    },
  ]);

  // 4. Вид в графе + заметка + копирование
  const view: SgContextMenuItem[] = [];
  const graphSub: SgContextMenuItem[] = [];
  if (extras.onToggleSolo) {
    graphSub.push({
      label: extras.isSolo ? m.soloOff : m.solo,
      action: extras.isSolo && extras.onClearSolo ? extras.onClearSolo : extras.onToggleSolo,
    });
  }
  if (extras.onToggleHide) graphSub.push({ label: extras.isHidden ? m.unhide : m.hide, action: extras.onToggleHide });
  if (extras.onTogglePin) graphSub.push({ label: extras.isPinned ? m.unpin : m.pin, action: extras.onTogglePin });
  if (graphSub.length > 0) view.push({ label: m.graph, submenu: graphSub });
  if (extras.onShowInfo) view.push({ label: m.note, action: extras.onShowInfo });
  view.push({ label: loc.contextMenu.copyName, action: () => copyToClipboard(branch.name) });
  groups.push(view);

  // 5. Переименовать / удалить — всегда последними
  const danger: SgContextMenuItem[] = [];
  if (isLocal) {
    danger.push({
      label: m.rename,
      action: () => showPrompt({
        title: tpl(loc.contextMenu.rename, { name: branch.name }),
        defaultValue: branch.name,
        placeholder: 'branch-name',
        onConfirm: (newName) => {
          if (newName && newName !== branch.name) {
            extras.onRename?.(branch.name, newName);
            postCommand({ type: 'renameBranch', oldName: branch.name, newName });
          }
        },
      }),
    });
    if (other) {
      danger.push({
        label: m.delete,
        danger: true,
        action: () => showPrompt({
          kind: 'confirm',
          title: tpl(loc.dialog.deleteBranchTitle, { branch: branch.name }),
          message: loc.dialog.deleteBranchMessage,
          confirmLabel: loc.dialog.delete,
          danger: true,
          onConfirm: () => {
            extras.onDelete?.();
            postCommand({ type: 'deleteBranch', branch: branch.name, force: true });
          },
        }),
      });
    }
  }
  groups.push(danger);

  const items: SgContextMenuItem[] = [header];
  for (const g of groups) {
    if (g.length === 0) continue;
    items.push({ divider: true }, ...g);
  }
  return items;
}

export function getTagMenuItems(tag: Tag, loc: Loc, showPrompt: ShowPrompt, requestCheckout: RequestCheckout): SgContextMenuItem[] {
  return [
    { label: tpl(loc.contextMenu.checkout, { branch: tag.name }), action: () => requestCheckout(tag.name) },
    { divider: true },
    {
      label: tpl(loc.contextMenu.delete, { name: tag.name }),
      danger: true,
      action: () => showPrompt({
        kind: 'confirm',
        title: tpl(loc.dialog.deleteTagTitle, { tag: tag.name }),
        confirmLabel: loc.dialog.delete,
        danger: true,
        onConfirm: () => postCommand({ type: 'deleteTag', name: tag.name }),
      }),
    },
    { divider: true },
    { label: loc.contextMenu.copyName, action: () => copyToClipboard(tag.name) },
  ];
}

export function getStashMenuItems(
  stash: Stash,
  loc: Loc,
  showPrompt: ShowPrompt,
  requestApplyStash: RequestApplyStash,
  onShowStash?: (stash: Stash) => void,
): SgContextMenuItem[] {
  return [
    {
      label: loc.contextMenu.stashShow,
      action: () => {
        if (onShowStash) onShowStash(stash);
        else postCommand({ type: 'stashShow', index: stash.index });
      },
    },
    { divider: true },
    { label: loc.contextMenu.stashApply, action: () => requestApplyStash(stash) },
    { label: loc.contextMenu.stashPop, action: () => postCommand({ type: 'stashPopIndex', index: stash.index }) },
    { divider: true },
    {
      label: loc.contextMenu.stashDrop,
      danger: true,
      action: () => showPrompt({
        kind: 'confirm',
        title: tpl(loc.contextMenu.stashDrop, { stash: stash.message }),
        message: stash.message,
        confirmLabel: loc.dialog.delete,
        danger: true,
        onConfirm: () => postCommand({ type: 'stashDrop', index: stash.index }),
      }),
    },
  ];
}

export function getRemoteMenuItems(remote: Remote, loc: Loc, showPrompt: ShowPrompt): SgContextMenuItem[] {
  return [
    { label: tpl(loc.contextMenu.fetchRemote, { remote: remote.name }), action: () => postCommand({ type: 'fetch', remote: remote.name }) },
    { divider: true },
    {
      label: tpl(loc.contextMenu.rename, { name: remote.name }),
      action: () => showPrompt({
        title: tpl(loc.contextMenu.rename, { name: remote.name }),
        defaultValue: remote.name,
        onConfirm: (newName) => postCommand({ type: 'renameRemote', oldName: remote.name, newName }),
      }),
    },
    {
      label: tpl(loc.contextMenu.deleteRemote, { remote: remote.name }),
      danger: true,
      action: () => showPrompt({
        kind: 'confirm',
        title: tpl(loc.contextMenu.deleteRemote, { remote: remote.name }),
        confirmLabel: loc.dialog.delete,
        danger: true,
        onConfirm: () => postCommand({ type: 'removeRemote', name: remote.name }),
      }),
    },
    { divider: true },
    { label: loc.contextMenu.copyName, action: () => copyToClipboard(remote.name) },
    { label: loc.contextMenu.copyUrl, action: () => copyToClipboard(remote.fetchUrl) },
  ];
}
