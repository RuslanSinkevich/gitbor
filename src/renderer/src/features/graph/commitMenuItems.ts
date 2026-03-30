import { t, tpl } from '../../i18n';
import { postCommand } from '../../api';
import type { Commit } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';

export type ShowPrompt = (opts: {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
}) => void;

function formatCommitInfo(commit: Commit): string {
  const date = commit.authorDate
    ? new Date(commit.authorDate).toISOString().replace('T', ' ').substring(0, 19)
    : '';
  return `${commit.hash.substring(0, 7)} ${commit.subject}\nAuthor: ${commit.authorName}\nDate: ${date}`;
}

export type OnRebase = (onto: string) => void;

export function getCommitMenuItems(commit: Commit, currentBranch: string, showPrompt: ShowPrompt, onRebase?: OnRebase): SgContextMenuItem[] {
  const loc = t();
  const shortHash = commit.hash.substring(0, 7);

  const items: SgContextMenuItem[] = [];

  const branchRefs = commit.refs.filter(r => r.type === 'branch' || r.type === 'remote');
  for (const ref of branchRefs) {
    items.push({ header: true, label: ref.name, action: () => postCommand({ type: 'checkout', branch: ref.name }) });
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
    { divider: true },

    { label: tpl(loc.contextMenu.mergeInto, { source: shortHash, target: currentBranch }), action: () => postCommand({ type: 'startMerge', source: commit.hash, options: { noCommit: false, ffOnly: false, squash: false } }) },
    { label: tpl(loc.contextMenu.rebaseToHere, { branch: currentBranch }), disabled: true },
    {
      label: tpl(loc.contextMenu.interactiveRebaseToHere, { branch: currentBranch }),
      action: onRebase ? () => onRebase(commit.hash) : undefined,
      disabled: !onRebase,
    },
    { divider: true },

    { label: tpl(loc.contextMenu.resetToHere, { branch: currentBranch }), disabled: true },
    { label: loc.contextMenu.resetSoft, action: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'soft' }) },
    { label: loc.contextMenu.resetMixed, action: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'mixed' }) },
    { label: loc.contextMenu.resetHard, danger: true, action: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'hard' }) },
    { divider: true },

    { label: loc.contextMenu.checkoutCommit, action: () => postCommand({ type: 'checkout', branch: commit.hash }) },
    { label: loc.contextMenu.cherryPick, action: () => postCommand({ type: 'cherryPick', hash: commit.hash }) },
    { label: loc.contextMenu.revert, action: () => postCommand({ type: 'revert', hash: commit.hash }) },
    { divider: true },

    { label: loc.contextMenu.saveAsPatch, disabled: true },
    { divider: true },

    { label: loc.contextMenu.compareToLocal, disabled: true },
    { divider: true },

    { label: loc.contextMenu.copySha, shortcut: 'Ctrl+C', action: () => navigator.clipboard.writeText(commit.hash) },
    { label: loc.contextMenu.copyCommitInfo, shortcut: 'Ctrl+Shift+C', action: () => navigator.clipboard.writeText(formatCommitInfo(commit)) },
  );

  return items;
}
