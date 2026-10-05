import { tpl } from '../../i18n';
import { postCommand, copyToClipboard } from '../../api';
import type { Branch, Tag, Stash, Remote } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import type { ShowPrompt } from '../graph/commitMenuItems';
import type { RequestCheckout } from '../checkout';
import type { RequestApplyStash } from '../stash';

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

export function getBranchMenuItems(
  branch: Branch, currentBranch: string, loc: Loc, showPrompt: ShowPrompt,
  requestCheckout: RequestCheckout, onMerge?: (source: string) => void,
  extras: BranchExtrasMenu = {},
  remoteNames: string[] = [],
  onCompare?: (branch: string) => void,
): SgContextMenuItem[] {
  const short = leaf(branch.name);
  const shortCurrent = leaf(currentBranch);
  const items: SgContextMenuItem[] = [];
  if (!branch.isCurrent) {
    items.push({
      label: tpl(loc.contextMenu.checkout, { branch: short }),
      title: tpl(loc.contextMenu.checkout, { branch: branch.name }),
      action: () => requestCheckout(branch.name),
    });
    items.push({ divider: true });
    items.push({
      label: tpl(loc.contextMenu.mergeInto, { source: short, target: shortCurrent }),
      title: tpl(loc.contextMenu.mergeInto, { source: branch.name, target: currentBranch }),
      action: () => onMerge ? onMerge(branch.name) : postCommand({ type: 'merge', branch: branch.name }),
    });
    // Что принесёт ветка при слиянии: дифф от merge-base до вершины ветки.
    // Список файлов — в режиме сравнения CommitsView, дифф по клику на файл.
    if (onCompare) {
      items.push({
        label: loc.contextMenu.compareWithCurrent,
        help: tpl(loc.contextMenu.help.compareWithCurrent, { branch: short, target: shortCurrent || 'HEAD' }),
        action: () => onCompare(branch.name),
      });
    }
  }
  // Обновить неактивную ЛОКАЛЬНУЮ ветку без переключения:
  // `git fetch <remote> <branch>:<branch>` (fast-forward). Активной и
  // remote-веткам пункт не показываем — там смысла нет (у remote своя fetch,
  // активную тянут обычным Pull). Без upstream — модалка выбора remote.
  if (!branch.isCurrent && !branch.isRemote) {
    items.push({ divider: true });
    items.push({
      label: loc.contextMenu.fetchBranch,
      title: tpl(loc.contextMenu.fetchBranchTitle, { branch: branch.name }),
      action: () => promptFetchBranch(branch, loc, showPrompt, remoteNames),
    });
  }
  // Track Remote Branch (как в Fork): только для remote-веток. Создаёт
  // локальную ветку с tracking на эту remote и переключается на неё.
  if (branch.isRemote) {
    items.push({ divider: true });
    items.push({
      label: loc.contextMenu.trackRemote,
      title: tpl(loc.contextMenu.trackRemoteTitle, { branch: branch.name }),
      action: () => promptTrackRemote(branch, loc, showPrompt),
    });
  }
  if (!branch.isRemote) {
    items.push({
      label: tpl(loc.contextMenu.rename, { name: short }),
      title: tpl(loc.contextMenu.rename, { name: branch.name }),
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
    if (!branch.isCurrent) {
      items.push({
        label: tpl(loc.contextMenu.delete, { name: short }),
        title: tpl(loc.contextMenu.delete, { name: branch.name }),
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
  items.push({ divider: true });
  items.push({
    label: tpl(loc.contextMenu.newBranch, { ref: short }),
    title: tpl(loc.contextMenu.newBranch, { ref: branch.name }),
    action: () => showPrompt({
      title: tpl(loc.contextMenu.newBranch, { ref: branch.name }),
      placeholder: 'branch-name',
      onConfirm: (name) => postCommand({ type: 'createBranch', name, from: branch.name }),
    }),
  });
  items.push({
    label: tpl(loc.contextMenu.newTag, { ref: short }),
    title: tpl(loc.contextMenu.newTag, { ref: branch.name }),
    action: () => showPrompt({
      title: tpl(loc.contextMenu.newTag, { ref: branch.name }),
      placeholder: 'v1.0.0',
      onConfirm: (name) => postCommand({ type: 'createTag', name, ref: branch.name }),
    }),
  });

  if (extras.onTogglePin || extras.onToggleSolo || extras.onToggleHide || extras.onShowInfo) {
    items.push({ divider: true });
    if (extras.onTogglePin) {
      items.push({
        label: extras.isPinned ? loc.sidebar.unpinBranch : loc.sidebar.pinBranch,
        action: extras.onTogglePin,
      });
    }
    if (extras.onToggleSolo) {
      items.push({
        label: extras.isSolo ? loc.sidebar.clearGraphFilter : loc.sidebar.soloGraph,
        action: extras.isSolo && extras.onClearSolo ? extras.onClearSolo : extras.onToggleSolo,
      });
    }
    if (extras.onToggleHide) {
      items.push({
        label: extras.isHidden ? loc.sidebar.unhideBranch : loc.sidebar.hideBranch,
        action: extras.onToggleHide,
      });
    }
    if (extras.onShowInfo) {
      items.push({
        label: loc.sidebar.branchInfo,
        action: extras.onShowInfo,
      });
    }
  }

  items.push({ divider: true });
  items.push({ label: loc.contextMenu.copyName, action: () => copyToClipboard(branch.name) });
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
