import { t, tpl } from '../../i18n';
import { postCommand, copyToClipboard } from '../../api';
import type { Commit } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import type { RequestCheckout } from '../checkout';
import type { ShowPromptFn } from '../../ui/SgPromptDialog';

export type ShowPrompt = ShowPromptFn;

function formatCommitInfo(commit: Commit): string {
  const date = commit.authorDate
    ? new Date(commit.authorDate).toISOString().replace('T', ' ').substring(0, 19)
    : '';
  return `${commit.hash.substring(0, 7)} ${commit.subject}\nAuthor: ${commit.authorName}\nDate: ${date}`;
}

export type OnRebase = (onto: string) => void;

export function getCommitMenuItems(
  commit: Commit, currentBranch: string, showPrompt: ShowPrompt, requestCheckout: RequestCheckout,
  onRebase?: OnRebase, compareFrom?: string | null, onCompareFrom?: (hash: string) => void, onCompareTo?: (from: string, to: string) => void,
): SgContextMenuItem[] {
  const loc = t();
  const shortHash = commit.hash.substring(0, 7);

  const items: SgContextMenuItem[] = [];

  const branchRefs = commit.refs.filter(r => r.type === 'branch' || r.type === 'remote');
  for (const ref of branchRefs) {
    items.push({ header: true, label: ref.name, action: () => requestCheckout(ref.name) });
  }
  if (branchRefs.length > 0) items.push({ divider: true });

  items.push(
    {
      label: tpl(loc.contextMenu.newBranch, { ref: shortHash }),
      shortcut: 'Ctrl+Shift+B',
      action: () => showPrompt({
        title: tpl(loc.contextMenu.newBranch, { ref: shortHash }),
        label: loc.contextMenu.newBranch.replace(/\s*'{ref}'.*/, ''),
        placeholder: 'branch-name',
        onConfirm: (name) => postCommand({ type: 'createBranch', name, from: commit.hash }),
      }),
    },
    {
      label: tpl(loc.contextMenu.newTag, { ref: shortHash }),
      shortcut: 'Ctrl+Shift+T',
      action: () => showPrompt({
        title: tpl(loc.contextMenu.newTag, { ref: shortHash }),
        placeholder: 'v1.0.0',
        onConfirm: (name) => postCommand({ type: 'createTag', name, ref: commit.hash }),
      }),
    },
    {
      label: loc.contextMenu.newAnnotatedTag,
      action: () => showPrompt({
        title: loc.contextMenu.newAnnotatedTag,
        placeholder: 'v1.0.0',
        onConfirm: (name) => showPrompt({
          title: loc.contextMenu.tagMessageTitle,
          placeholder: 'Release v1.0.0',
          onConfirm: (message) => postCommand({ type: 'createTag', name, ref: commit.hash, message }),
        }),
      }),
    },
    { divider: true },

    { label: tpl(loc.contextMenu.mergeInto, { source: shortHash, target: currentBranch }), action: () => postCommand({ type: 'startMerge', source: commit.hash, options: { noCommit: false, ffOnly: false, squash: false } }) },
    { label: tpl(loc.contextMenu.rebaseToHere, { branch: currentBranch }), action: () => postCommand({ type: 'rebaseTo', onto: commit.hash }) },
    {
      label: tpl(loc.contextMenu.interactiveRebaseToHere, { branch: currentBranch }),
      action: onRebase ? () => onRebase(commit.hash) : undefined,
      disabled: !onRebase,
    },
    { divider: true },

    {
      label: tpl(loc.contextMenu.resetToHere, { branch: currentBranch }),
      submenu: [
        { label: loc.contextMenu.resetSoft, action: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'soft' }) },
        { label: loc.contextMenu.resetMixed, action: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'mixed' }) },
        {
          label: loc.contextMenu.resetHard,
          danger: true,
          action: () => showPrompt({
            kind: 'confirm',
            title: loc.dialog.resetHardTitle,
            message: loc.dialog.resetHardMessage,
            confirmLabel: loc.contextMenu.resetHard,
            danger: true,
            onConfirm: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'hard' }),
          }),
        },
      ],
    },
    { divider: true },

    { label: loc.contextMenu.checkoutCommit, action: () => requestCheckout(commit.hash) },
    {
      label: loc.contextMenu.cherryPick,
      action: () => postCommand({
        type: 'cherryPick',
        hash: commit.hash,
        ...(commit.parents.length > 1 ? { mainline: 1 } : {}),
      }),
    },
    {
      label: loc.contextMenu.revert,
      action: () => postCommand({
        type: 'revert',
        hash: commit.hash,
        ...(commit.parents.length > 1 ? { mainline: 1 } : {}),
      }),
    },
    { divider: true },

    { label: loc.contextMenu.saveAsPatch, action: () => postCommand({ type: 'saveAsPatch', hash: commit.hash }) },
    { divider: true },

    { label: loc.contextMenu.compareToLocal, action: () => postCommand({ type: 'openDiff', file: '.', hash: commit.hash }) },
    { label: loc.contextMenu.compareFrom, action: () => onCompareFrom?.(commit.hash) },
    ...(compareFrom && compareFrom !== commit.hash ? [{
      label: tpl(loc.contextMenu.compareTo, { hash: compareFrom.substring(0, 7) }),
      action: () => onCompareTo?.(compareFrom, commit.hash),
    }] : []),
    { divider: true },

    { label: loc.contextMenu.copySha, shortcut: 'Ctrl+C', action: () => copyToClipboard(commit.hash) },
    { label: loc.contextMenu.copyCommitInfo, shortcut: 'Ctrl+Shift+C', action: () => copyToClipboard(formatCommitInfo(commit)) },
  );

  return items;
}
