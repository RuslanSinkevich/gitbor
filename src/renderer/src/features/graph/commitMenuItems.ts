import { t, tpl } from '../../i18n';
import { postCommand, copyToClipboard } from '../../api';
import type { Commit } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import type { RequestCheckout } from '../checkout';
import type { ShowPromptFn } from '../../ui/SgPromptDialog';
import { commitUrl, pullRequestUrl, parsePullRequestId, type WebRepo } from './webLinks';

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

const leaf = (name: string) => name.slice(name.lastIndexOf('/') + 1);

const WEB_HOST_NAME: Record<WebRepo['host'], string> = {
  azure: 'Azure DevOps',
  github: 'GitHub',
  gitlab: 'GitLab',
};

export type OnRebase = (onto: string) => void;

export interface CommitMenuExtras {
  /** Веб-интерфейс репозитория (по адресу remote) — для «Открыть в …». */
  webRepo?: WebRepo | null;
  /** Окно «В каких ветках есть этот коммит». */
  onShowContaining?: (commit: Commit) => void;
}

/**
 * Меню коммита в графе. Заголовок — короткий хеш и тема (статичный). Корень —
 * частые действия глаголами; всё, что меняет ТЕКУЩУЮ ветку (влить,
 * перебазировать, сбросить), — в подменю «В «ветка»», поэтому длинное имя
 * ветки встречается один раз, а опасное спрятано на шаг глубже. Пояснения —
 * во всплывающей подсказке (`title`), без значков «!».
 */
export function getCommitMenuItems(
  commit: Commit, currentBranch: string, showPrompt: ShowPrompt, requestCheckout: RequestCheckout,
  onRebase?: OnRebase, onCompareTo?: (from: string, to: string) => void,
  headOnRemote = false,
  /** Мульти-выбор, отсортированный старые→новые. Если кликнутый коммит в нём
      и коммитов > 1 — пункт «Cherry-pick N коммитов» вместо одиночного. */
  selectedHashes?: string[],
  /** Сброс мульти-выбора после старта batch cherry-pick. */
  onMultiCherryPickStart?: () => void,
  extras: CommitMenuExtras = {},
): SgContextMenuItem[] {
  const loc = t();
  const cm = loc.contextMenu;
  const m = loc.commitMenu;
  const shortHash = commit.hash.substring(0, 7);
  const cur = leaf(currentBranch) || 'HEAD';

  const multiCount = selectedHashes && selectedHashes.length > 1 && selectedHashes.includes(commit.hash)
    ? selectedHashes.length
    : 0;
  const cherryPickItem: SgContextMenuItem = multiCount > 0
    ? {
      label: tpl(cm.cherryPickMany, { count: multiCount }),
      title: cm.help.cherryPickMany,
      action: () => {
        onMultiCherryPickStart?.();
        postCommand({ type: 'cherryPickMany', hashes: selectedHashes! });
      },
    }
    : {
      label: m.cherryPick,
      title: cm.help.cherryPick,
      action: () => postCommand({
        type: 'cherryPick',
        hash: commit.hash,
        ...(commit.parents.length > 1 ? { mainline: 1 } : {}),
      }),
    };

  const groups: SgContextMenuItem[][] = [];

  // 1. Частое: скопировать / применить / откатить
  groups.push([
    { label: cm.copySha, shortcut: 'Ctrl+C', action: () => copyToClipboard(commit.hash) },
    { label: m.copyMessage, action: () => copyToClipboard(commit.subject) },
    cherryPickItem,
    {
      label: m.revert,
      title: cm.help.revert,
      action: () => postCommand({
        type: 'revert',
        hash: commit.hash,
        ...(commit.parents.length > 1 ? { mainline: 1 } : {}),
      }),
    },
  ]);

  // 2. Создать
  groups.push([
    {
      label: m.newBranch,
      shortcut: 'Ctrl+Shift+B',
      action: () => showPrompt({
        title: tpl(cm.newBranch, { ref: shortHash }),
        label: cm.newBranch.replace(/\s*'{ref}'.*/, ''),
        placeholder: 'branch-name',
        onConfirm: (name) => postCommand({ type: 'createBranch', name, from: commit.hash }),
      }),
    },
    {
      label: m.newTag,
      shortcut: 'Ctrl+Shift+T',
      action: () => showPrompt({
        title: tpl(cm.newTag, { ref: shortHash }),
        placeholder: 'v1.0.0',
        onConfirm: (name) => postCommand({ type: 'createTag', name, ref: commit.hash }),
      }),
    },
  ]);

  // 3. Текущая ветка и переключение
  const branchSub: SgContextMenuItem[] = [];
  if (isCurrentHead(commit) && commit.parents.length > 0 && !headOnRemote) {
    branchSub.push(
      { label: cm.uncommitToStaging, title: cm.help.uncommitToStaging, action: () => postCommand({ type: 'resetTo', hash: commit.parents[0], mode: 'soft' }) },
      { divider: true },
    );
  }
  branchSub.push(
    { label: m.mergeHere, title: cm.help.mergeInto, action: () => postCommand({ type: 'startMerge', source: commit.hash, options: { noCommit: false, ffOnly: false, squash: false } }) },
    { label: m.rebaseHere, title: cm.help.rebaseToHere, action: () => postCommand({ type: 'rebaseTo', onto: commit.hash }) },
    {
      label: m.rebaseInteractive,
      title: cm.help.interactiveRebaseToHere,
      action: onRebase ? () => onRebase(commit.hash) : undefined,
      disabled: !onRebase,
    },
    { divider: true },
    {
      label: m.resetHere,
      submenu: [
        { label: cm.resetSoft, title: cm.help.resetSoft, action: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'soft' }) },
        { label: cm.resetMixed, title: cm.help.resetMixed, action: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'mixed' }) },
        {
          label: cm.resetHard,
          danger: true,
          title: cm.help.resetHard,
          action: () => showPrompt({
            kind: 'confirm',
            title: loc.dialog.resetHardTitle,
            message: loc.dialog.resetHardMessage,
            confirmLabel: cm.resetHard,
            danger: true,
            onConfirm: () => postCommand({ type: 'resetTo', hash: commit.hash, mode: 'hard' }),
          }),
        },
      ],
    },
  );
  const nav: SgContextMenuItem[] = [
    { label: tpl(m.onBranch, { branch: cur }), submenu: branchSub },
    { label: m.checkout, title: cm.help.checkoutCommit, action: () => requestCheckout(commit.hash) },
  ];
  // Локальные ветки на этом коммите — явные пункты вместо скрытого клика по заголовку.
  for (const ref of commit.refs.filter(r => r.type === 'branch').slice(0, 3)) {
    nav.push({ label: tpl(cm.checkout, { branch: leaf(ref.name) }), title: ref.name, action: () => requestCheckout(ref.name) });
  }
  groups.push(nav);

  // 4. Где этот коммит: ветки, веб-интерфейс, PR
  const where: SgContextMenuItem[] = [];
  if (extras.onShowContaining) where.push({ label: m.containing, action: () => extras.onShowContaining!(commit) });
  const web = extras.webRepo;
  if (web) {
    where.push({ label: tpl(m.openWeb, { host: WEB_HOST_NAME[web.host] }), action: () => window.open(commitUrl(web, commit.hash), '_blank') });
    const prId = parsePullRequestId(commit.subject);
    if (prId) where.push({ label: tpl(m.openPr, { id: prId }), action: () => window.open(pullRequestUrl(web, prId), '_blank') });
  }
  groups.push(where);

  // 5. Ещё — редкое
  groups.push([{
    label: m.more,
    submenu: [
      {
        label: cm.newAnnotatedTag,
        action: () => showPrompt({
          title: cm.newAnnotatedTag,
          placeholder: 'v1.0.0',
          onConfirm: (name) => showPrompt({
            title: cm.tagMessageTitle,
            placeholder: 'Release v1.0.0',
            onConfirm: (message) => postCommand({ type: 'createTag', name, ref: commit.hash, message }),
          }),
        }),
      },
      ...(onCompareTo ? [
        { label: cm.compareToLocal, title: cm.help.compareToLocal, action: () => onCompareTo(commit.hash, 'WORKING') },
      ] as SgContextMenuItem[] : []),
      { label: cm.saveAsPatch, title: cm.help.saveAsPatch, action: () => postCommand({ type: 'saveAsPatch', hash: commit.hash }) },
      { label: cm.copyCommitInfo, shortcut: 'Ctrl+Shift+C', action: () => copyToClipboard(formatCommitInfo(commit)) },
    ],
  }]);

  const items: SgContextMenuItem[] = [
    { header: true, label: `${shortHash} · ${commit.subject}`, title: `${commit.hash}\n${commit.subject}` },
  ];
  for (const g of groups) {
    if (g.length === 0) continue;
    items.push({ divider: true }, ...g);
  }
  return items;
}
