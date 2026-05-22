import { tpl } from '../../i18n';
import { postCommand, copyToClipboard } from '../../api';
import type { Branch, Tag, Stash, Remote } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import type { ShowPrompt } from '../graph/commitMenuItems';
import type { RequestCheckout } from '../checkout';

type Loc = ReturnType<typeof import('../../i18n').t>;

export function getBranchMenuItems(
  branch: Branch, currentBranch: string, loc: Loc, showPrompt: ShowPrompt,
  requestCheckout: RequestCheckout, onMerge?: (source: string) => void,
): SgContextMenuItem[] {
  const items: SgContextMenuItem[] = [];
  if (!branch.isCurrent) {
    items.push({ label: tpl(loc.contextMenu.checkout, { branch: branch.name }), action: () => requestCheckout(branch.name) });
    items.push({ divider: true });
    items.push({
      label: tpl(loc.contextMenu.mergeInto, { source: branch.name, target: currentBranch }),
      action: () => onMerge ? onMerge(branch.name) : postCommand({ type: 'merge', branch: branch.name }),
    });
  }
  if (!branch.isRemote) {
    items.push({
      label: tpl(loc.contextMenu.rename, { name: branch.name }),
      action: () => showPrompt({
        title: tpl(loc.contextMenu.rename, { name: branch.name }),
        defaultValue: branch.name,
        onConfirm: (newName) => postCommand({ type: 'renameBranch', oldName: branch.name, newName }),
      }),
    });
    if (!branch.isCurrent) {
      items.push({
        label: tpl(loc.contextMenu.delete, { name: branch.name }),
        danger: true,
        action: () => showPrompt({
          title: tpl(loc.dialog.deleteBranchTitle, { branch: branch.name }),
          message: loc.dialog.deleteBranchMessage,
          confirmLabel: loc.dialog.delete,
          danger: true,
          onConfirm: () => postCommand({ type: 'deleteBranch', branch: branch.name }),
        }),
      });
    }
  }
  items.push({ divider: true });
  items.push({
    label: tpl(loc.contextMenu.newBranch, { ref: branch.name }),
    action: () => showPrompt({
      title: tpl(loc.contextMenu.newBranch, { ref: branch.name }),
      placeholder: 'branch-name',
      onConfirm: (name) => postCommand({ type: 'createBranch', name, from: branch.name }),
    }),
  });
  items.push({
    label: tpl(loc.contextMenu.newTag, { ref: branch.name }),
    action: () => showPrompt({
      title: tpl(loc.contextMenu.newTag, { ref: branch.name }),
      placeholder: 'v1.0.0',
      onConfirm: (name) => postCommand({ type: 'createTag', name, ref: branch.name }),
    }),
  });
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

export function getStashMenuItems(stash: Stash, loc: Loc, showPrompt: ShowPrompt, onShowStash?: (index: string) => void): SgContextMenuItem[] {
  return [
    { label: loc.contextMenu.stashShow, action: () => onShowStash?.(stash.index) ?? postCommand({ type: 'stashShow', index: stash.index }) },
    { divider: true },
    { label: tpl(loc.contextMenu.stashApply, { stash: stash.message }), action: () => postCommand({ type: 'stashApply', index: stash.index }) },
    { label: tpl(loc.contextMenu.stashPop, { stash: stash.message }), action: () => postCommand({ type: 'stashPopIndex', index: stash.index }) },
    { divider: true },
    {
      label: tpl(loc.contextMenu.stashDrop, { stash: stash.message }),
      danger: true,
      action: () => showPrompt({
        title: tpl(loc.contextMenu.stashDrop, { stash: stash.message }),
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
