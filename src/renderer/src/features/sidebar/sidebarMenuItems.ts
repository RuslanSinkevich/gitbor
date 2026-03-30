import { tpl } from '../../i18n';
import { postCommand } from '../../api';
import type { Branch, Tag, Stash, Remote } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import type { ShowPrompt } from '../graph/commitMenuItems';

type Loc = ReturnType<typeof import('../../i18n').t>;

export function getBranchMenuItems(branch: Branch, currentBranch: string, loc: Loc, showPrompt: ShowPrompt, onMerge?: (source: string) => void): SgContextMenuItem[] {
  const items: SgContextMenuItem[] = [];
  if (!branch.isCurrent) {
    items.push({ label: tpl(loc.contextMenu.checkout, { branch: branch.name }), action: () => postCommand({ type: 'checkout', branch: branch.name }) });
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
    items.push({ label: tpl(loc.contextMenu.delete, { name: branch.name }), danger: true, action: () => postCommand({ type: 'deleteBranch', branch: branch.name }) });
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
  items.push({ label: loc.contextMenu.copyName, action: () => navigator.clipboard.writeText(branch.name) });
  return items;
}

export function getTagMenuItems(tag: Tag, loc: Loc): SgContextMenuItem[] {
  return [
    { label: tpl(loc.contextMenu.checkout, { branch: tag.name }), action: () => postCommand({ type: 'checkout', branch: tag.name }) },
    { divider: true },
    { label: tpl(loc.contextMenu.delete, { name: tag.name }), danger: true, action: () => postCommand({ type: 'deleteTag', name: tag.name }) },
    { divider: true },
    { label: loc.contextMenu.copyName, action: () => navigator.clipboard.writeText(tag.name) },
  ];
}

export function getStashMenuItems(stash: Stash, loc: Loc): SgContextMenuItem[] {
  return [
    { label: tpl(loc.contextMenu.stashApply, { stash: stash.message }), action: () => postCommand({ type: 'stashApply', index: stash.index }) },
    { label: tpl(loc.contextMenu.stashPop, { stash: stash.message }), action: () => postCommand({ type: 'stashPop' }) },
    { divider: true },
    { label: tpl(loc.contextMenu.stashDrop, { stash: stash.message }), danger: true, action: () => postCommand({ type: 'stashDrop', index: stash.index }) },
  ];
}

export function getRemoteMenuItems(remote: Remote, loc: Loc, showPrompt?: ShowPrompt): SgContextMenuItem[] {
  return [
    { label: tpl(loc.contextMenu.fetchRemote, { remote: remote.name }), action: () => postCommand({ type: 'fetch' }) },
    { divider: true },
    ...(showPrompt ? [{
      label: `Rename "${remote.name}"...`,
      action: () => showPrompt({
        title: `Rename remote "${remote.name}"`,
        defaultValue: remote.name,
        onConfirm: (newName: string) => postCommand({ type: 'renameRemote', oldName: remote.name, newName }),
      }),
    }] : []),
    { label: `Remove "${remote.name}"`, danger: true, action: () => postCommand({ type: 'removeRemote', name: remote.name }) },
    { divider: true },
    { label: loc.contextMenu.copyName, action: () => navigator.clipboard.writeText(remote.name) },
    { label: loc.contextMenu.copyUrl, action: () => navigator.clipboard.writeText(remote.fetchUrl) },
  ];
}
