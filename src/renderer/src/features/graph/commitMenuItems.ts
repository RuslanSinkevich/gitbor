import { t, tpl } from '../../i18n';
import { postCommand, copyToClipboard } from '../../api';
import type { Commit } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import type { RequestCheckout } from '../checkout';
import type { ShowPromptFn } from '../../ui/SgPromptDialog';

export type ShowPrompt = ShowPromptFn;

function isCurrentHead(commit: Commit): boolean {
  return commit.refs.some(r => r.type === 'head');
}

function formatCommitInfo(commit: Commit): string {
  const date = commit.authorDate
    ? new Date(commit.authorDate).toISOString().replace('T', ' ').substring(0, 19)
    : '';
  return `${commit.hash.substring(0, 7)} ${commit.subject}\nAuthor: ${commit.authorName}\nDate: ${date}`;
}

export type OnRebase = (onto: string) => void;

export function getCommitMenuItems(
  commit: Commit, currentBranch: string, showPrompt: ShowPrompt, requestCheckout: RequestCheckout,
  onRebase?: OnRebase, onCompareTo?: (from: string, to: string) => void,
  headOnRemote = false,
  /** Мульти-выбор, отсортированный старые→новые. Если кликнутый коммит в нём
      и коммитов > 1 — пункт «Cherry-pick N коммитов» вместо одиночного. */
  selectedHashes?: string[],
  /** Сброс мульти-выбора после старта batch cherry-pick. */
  onMultiCherryPickStart?: () => void,
): SgContextMenuItem[] {
  const loc = t();
  const shortHash = commit.hash.substring(0, 7);

  const multiCount = selectedHashes && selectedHashes.length > 1 && selectedHashes.includes(commit.hash)
    ? selectedHashes.length
    : 0;
  const cherryPickItem: SgContextMenuItem = multiCount > 0
    ? {
      label: tpl(loc.contextMenu.cherryPickMany, { count: multiCount }),
      help: loc.contextMenu.help.cherryPickMany,
      action: () => {
        onMultiCherryPickStart?.();
        postCommand({ type: 'cherryPickMany', hashes: selectedHashes! });
      },
    }
    : {
      label: loc.contextMenu.cherryPick,
      help: loc.contextMenu.help.cherryPick,
      action: () => postCommand({
        type: 'cherryPick',
        hash: commit.hash,
        ...(commit.parents.length > 1 ? { mainline: 1 } : {}),
      }),
    };

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

    { label: tpl(loc.contextMenu.mergeInto, { source: shortHash, target: currentBranch }), help: loc.contextMenu.help.mergeInto, action: () => postCommand({ type: 'startMerge', source: commit.hash, options: { noCommit: false, ffOnly: false, squash: false } }) },
    { label: tpl(loc.contextMenu.rebaseToHere, { branch: currentBranch }), help: loc.contextMenu.help.rebaseToHere, action: () => postCommand({ type: 'rebaseTo', onto: commit.hash }) },
    {
      label: tpl(loc.contextMenu.interactiveRebaseToHere, { branch: currentBranch }),
      help: loc.contextMenu.help.interactiveRebaseToHere,
      action: onRebase ? () => onRebase(commit.hash) : undefined,
      disabled: !onRebase,
    },
    { divider: true },

    ...(isCurrentHead(commit) && commit.parents.length > 0 && !headOnRemote ? [
      { label: loc.contextMenu.uncommitToStaging, help: loc.contextMenu.help.uncommitToStaging, action: () => postCommand({ type: 'resetTo', hash: commit.parents[0], mode: 'soft' }) },
      { divider: true },
    ] as SgContextMenuItem[] : []),

    {
      label: tpl(loc.contextMenu.resetToHere, { branch: currentBranch }),
      submenu: [
        { label: loc.contextMenu.resetSoft, help: loc.contextMenu.help.resetSoft, action: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'soft' }) },
        { label: loc.contextMenu.resetMixed, help: loc.contextMenu.help.resetMixed, action: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'mixed' }) },
        {
          label: loc.contextMenu.resetHard,
          danger: true,
          help: loc.contextMenu.help.resetHard,
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

    { label: loc.contextMenu.checkoutCommit, help: loc.contextMenu.help.checkoutCommit, action: () => requestCheckout(commit.hash) },
    cherryPickItem,
    {
      label: loc.contextMenu.revert,
      help: loc.contextMenu.help.revert,
      action: () => postCommand({
        type: 'revert',
        hash: commit.hash,
        ...(commit.parents.length > 1 ? { mainline: 1 } : {}),
      }),
    },
    { divider: true },

    { label: loc.contextMenu.saveAsPatch, help: loc.contextMenu.help.saveAsPatch, action: () => postCommand({ type: 'saveAsPatch', hash: commit.hash }) },
    { divider: true },

    // «Сравнить с локальными» — выбранный коммит против рабочей копии
    // (toHash === 'WORKING') через onCompareTo. Результат открывается в режиме
    // сравнения CommitsView. Пункт показываем только когда сравнение доступно
    // (граф-вью).
    ...(onCompareTo ? [
      { label: loc.contextMenu.compareToLocal, help: loc.contextMenu.help.compareToLocal, action: () => onCompareTo(commit.hash, 'WORKING') },
    ] : []),
    { divider: true },

    { label: loc.contextMenu.copySha, shortcut: 'Ctrl+C', action: () => copyToClipboard(commit.hash) },
    { label: loc.contextMenu.copyCommitInfo, shortcut: 'Ctrl+Shift+C', action: () => copyToClipboard(formatCommitInfo(commit)) },
  );

  return items;
}
