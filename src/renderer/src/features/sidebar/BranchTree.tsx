import { useState, useCallback } from 'react';
import type { Branch } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { SgTooltip } from '../../ui/SgTooltip';
import { getBranchMenuItems } from './sidebarMenuItems';
import type { ShowPrompt } from '../graph/commitMenuItems';
import type { RequestCheckout } from '../checkout';
import {
  BRANCH_DND_TYPE,
  encodeBranchDnd,
  decodeBranchDnd,
  computeMovedBranchName,
} from './branchDnd';
import type { t } from '../../i18n';
import s from './Sidebar.module.css';

/** Длина превью заметки в tooltip. Дальше — `…`. */
const NOTE_PREVIEW_MAX = 200;

/**
 * Per-branch prefs из useBranchPrefs. Передаётся в дерево сверху, чтобы:
 * 1. Сортировать pinned наверх внутри одной папки (buildBranchTree).
 * 2. Показывать состояние иконок (pinned/hidden/solo) на строке ветки.
 * 3. Выкидывать соответствующие toggle-команды через context menu и hover.
 *
 * Контракт по именам:
 *   - локальные ветки — `branch.name` без префиксов (e.g. `feature/foo`)
 *   - remote-ветки — полный путь (e.g. `origin/main`); сейчас pin/solo/hide
 *     работают только для локальных (Fork тоже), поэтому remote-строки
 *     рендерятся без иконок.
 */
export interface BranchPrefsAPI {
  pinned: Set<string>;
  hidden: Set<string>;
  soloBranch: string | null;
  notes: Record<string, string>;
  togglePin: (name: string) => void;
  toggleHide: (name: string) => void;
  toggleSolo: (name: string) => void;
  clearSolo: () => void;
  showInfo: (branch: Branch) => void;
  renameBranch: (oldName: string, newName: string) => void;
}

/* ─── Tree node ─── */

export interface BranchTreeNode {
  segment: string;
  fullPath: string;
  branch: Branch | null;
  children: BranchTreeNode[];
}

export function buildBranchTree(
  branches: Branch[],
  stripPrefix = '',
  pinned?: Set<string>,
): BranchTreeNode[] {
  const root: BranchTreeNode[] = [];

  for (const branch of branches) {
    const name = stripPrefix ? branch.name.replace(stripPrefix, '') : branch.name;
    const parts = name.split('/');
    let currentChildren = root;
    let currentPath = stripPrefix;

    for (let i = 0; i < parts.length; i++) {
      const segment = parts[i];
      currentPath = currentPath ? currentPath + '/' + segment : segment;
      const isLeaf = i === parts.length - 1;

      let node = currentChildren.find(n => n.segment === segment);
      if (!node) {
        node = { segment, fullPath: currentPath, branch: isLeaf ? branch : null, children: [] };
        currentChildren.push(node);
      }
      if (isLeaf) node.branch = branch;
      currentChildren = node.children;
    }
  }

  /* Не схлопываем цепочки вида a/b/c в одну строку: каждый сегмент после `/` — отдельный уровень дерева. */
  return sortBranchTreeNodes(root, pinned);
}

function isPinnedNode(node: BranchTreeNode, pinned: Set<string>): boolean {
  if (node.branch && pinned.has(node.branch.name)) return true;
  return node.children.some(c => isPinnedNode(c, pinned));
}

function sortBranchTreeNodes(nodes: BranchTreeNode[], pinned?: Set<string>): BranchTreeNode[] {
  const sortedChildren = nodes.map(node => ({
    ...node,
    children: sortBranchTreeNodes(node.children, pinned),
  }));

  return sortedChildren.sort((a, b) => {
    /* Pinned (узлы с любой pinned-веткой внутри) — выше всех. Fork сортирует
       по принципу "pinned bubble up": папка с pinned-листом всплывает над
       обычными, даже если внутри есть и не-pinned ветки. */
    if (pinned && pinned.size > 0) {
      const aPin = isPinnedNode(a, pinned);
      const bPin = isPinnedNode(b, pinned);
      if (aPin !== bPin) return aPin ? -1 : 1;
    }
    const aIsFolder = a.children.length > 0;
    const bIsFolder = b.children.length > 0;
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1; // Папки выше листьев
    return a.segment.localeCompare(b.segment, undefined, { sensitivity: 'base', numeric: true });
  });
}

export function countLeaves(node: BranchTreeNode): number {
  if (node.children.length === 0) return node.branch ? 1 : 0;
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0) + (node.branch ? 1 : 0);
}

export interface BranchFolderExpand {
  isExpanded: (fullPath: string) => boolean;
  toggle: (fullPath: string) => void;
}

/* ─── BranchTreeItem ─── */

interface BranchTreeItemProps {
  node: BranchTreeNode;
  depth: number;
  /** Top-level строки в «Ветках» (не внутри .treeChildren). Все потомки — nested. */
  nested: boolean;
  currentBranch: string;
  loc: ReturnType<typeof t>;
  onContextMenu: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
  onSelectRef?: (hash: string) => void;
  onMerge?: (source: string) => void;
  showPrompt: ShowPrompt;
  requestCheckout: RequestCheckout;
  /** Если задано — развёрнутость папок из родителя (persist в localStorage). */
  folderExpand?: BranchFolderExpand;
  /** Callback при drop ветки в папку (вызывает prompt rename). */
  onBranchMove?: (oldName: string, newName: string) => void;
  /** Per-repo prefs для pin/solo/hide/info; не задано — фичи не показываются (актуально для remote-веток). */
  prefs?: BranchPrefsAPI;
  /** Имя выбранной (кликнутой) ветки — для подсветки «в фокусе», отдельно от checked-out. */
  selectedBranch?: string | null;
  /** Отметить ветку как выбранную при клике. */
  onSelectBranch?: (name: string) => void;
}

export function BranchTreeItem({ node, depth, nested, currentBranch, loc, onContextMenu, onSelectRef, onMerge, showPrompt, requestCheckout, folderExpand, onBranchMove, prefs, selectedBranch, onSelectBranch }: BranchTreeItemProps) {
  const [expandedInternal, setExpandedInternal] = useState(() => node.branch?.isCurrent ? true : depth < 1);
  const expanded = folderExpand ? folderExpand.isExpanded(node.fullPath) : expandedInternal;
  const toggleExpanded = folderExpand
    ? () => folderExpand.toggle(node.fullPath)
    : () => setExpandedInternal(e => !e);

  const [dropOver, setDropOver] = useState(false);
  const isFolder = node.children.length > 0;
  const branch = node.branch;
  const rowFolder = nested ? s.branchTreeFolderNested : s.branchTreeFolderRoot;
  const rowItem = nested ? s.branchTreeItemNested : s.branchTreeItemRoot;

  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!branch || branch.isRemote) { e.preventDefault(); return; }
    e.dataTransfer.setData(BRANCH_DND_TYPE, encodeBranchDnd({ kind: 'branch', name: branch.name, isLocal: !branch.isRemote }));
    e.dataTransfer.effectAllowed = 'move';
  }, [branch]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(BRANCH_DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDropOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const raw = e.dataTransfer.getData(BRANCH_DND_TYPE);
    const payload = decodeBranchDnd(raw);
    if (!payload || !payload.isLocal) return;
    const newName = computeMovedBranchName(payload.name, node.fullPath);
    if (newName !== payload.name && onBranchMove) {
      onBranchMove(payload.name, newName);
    }
  }, [node.fullPath, onBranchMove]);

  if (isFolder && !branch) {
    return (
      <>
        <div
          className={`${s.treeFolder} ${rowFolder}`}
          onClick={toggleExpanded}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={dropOver ? { outline: '2px solid var(--sg-primary)', borderRadius: 4 } : undefined}
        >
          <span className={`${s.arrow} ${expanded ? s.arrowExpanded : ''}`}>&#9656;</span>
          <span className={s.treeFolderIcon}>📁</span>
          <span className={s.treeFolderName}>{node.segment}</span>
          <span className={s.treeFolderCount}>{countLeaves(node)}</span>
        </div>
        {expanded && (
          <div className={s.treeChildren}>
            {node.children.map(child => (
              <BranchTreeItem key={child.fullPath} node={child} depth={depth + 1} nested
                currentBranch={currentBranch} loc={loc} onContextMenu={onContextMenu}
                onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} requestCheckout={requestCheckout} folderExpand={folderExpand} onBranchMove={onBranchMove} prefs={prefs} selectedBranch={selectedBranch} onSelectBranch={onSelectBranch} />
            ))}
          </div>
        )}
      </>
    );
  }

  if (branch) {
    /* Fork-style actions: pin / solo / hide / info. Видимы только когда
       prefs передан (для локальных веток). При hover/focus иконки всплывают
       через CSS opacity на .branchActions; активные состояния (pinned,
       soloBranch, hidden) подсвечиваются всегда. */
    const isPinned = prefs?.pinned.has(branch.name) ?? false;
    const isHidden = prefs?.hidden.has(branch.name) ?? false;
    const isSolo = prefs?.soloBranch === branch.name;
    const isSelected = selectedBranch != null && selectedBranch === branch.name;

    return (
      <>
        <div className={`${s.item} ${rowItem} ${branch.isCurrent ? s.itemCurrent : ''} ${isSelected ? s.itemSelected : ''} ${isHidden ? s.itemHiddenInGraph : ''}`}
          draggable={!branch.isRemote}
          onDragStart={handleDragStart}
          onClick={() => { onSelectBranch?.(branch.name); onSelectRef?.(branch.hash); }}
          onDoubleClick={() => !branch.isCurrent && requestCheckout(branch.name)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu(e, getBranchMenuItems(branch, currentBranch, loc, showPrompt, requestCheckout, onMerge, prefs ? {
              isPinned, isHidden, isSolo,
              onTogglePin: () => prefs.togglePin(branch.name),
              onToggleHide: () => prefs.toggleHide(branch.name),
              onToggleSolo: () => prefs.toggleSolo(branch.name),
              onClearSolo: () => prefs.clearSolo(),
              onShowInfo: () => prefs.showInfo(branch),
            } : {}));
          }}
>
          <span className={s.itemLabel}>
            {branch.isCurrent && (
              <span className={s.itemBadge} title={loc.sidebar.current} aria-label={loc.sidebar.current} />
            )}
            <span className={s.itemName}>{node.segment}</span>
          </span>
          {branch.upstream && <span className={s.itemUpstream} title={branch.upstream}>↔</span>}
          {prefs && !branch.isRemote && (
            <BranchHoverActions
              loc={loc}
              isPinned={isPinned}
              isHidden={isHidden}
              isSolo={isSolo}
              noteText={prefs.notes[branch.name] ?? ''}
              onTogglePin={(e) => { e.stopPropagation(); prefs.togglePin(branch.name); }}
              onToggleSolo={(e) => {
                e.stopPropagation();
                if (isSolo) prefs.clearSolo();
                else prefs.toggleSolo(branch.name);
              }}
              onToggleHide={(e) => { e.stopPropagation(); prefs.toggleHide(branch.name); }}
              onShowInfo={(e) => { e.stopPropagation(); prefs.showInfo(branch); }}
            />
          )}
        </div>
        {node.children.length > 0 && expanded && (
          <div className={s.treeChildren}>
            {node.children.map(child => (
              <BranchTreeItem key={child.fullPath} node={child} depth={depth + 1} nested
                currentBranch={currentBranch} loc={loc} onContextMenu={onContextMenu}
                onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} requestCheckout={requestCheckout} folderExpand={folderExpand} onBranchMove={onBranchMove} prefs={prefs} selectedBranch={selectedBranch} onSelectBranch={onSelectBranch} />
            ))}
          </div>
        )}
      </>
    );
  }

  return null;
}

interface BranchHoverActionsProps {
  loc: ReturnType<typeof t>;
  isPinned: boolean;
  isHidden: boolean;
  isSolo: boolean;
  /** Текущая заметка по ветке. Пустая строка — заметки нет, tooltip-плейсхолдер. */
  noteText: string;
  onTogglePin: (e: React.MouseEvent) => void;
  onToggleSolo: (e: React.MouseEvent) => void;
  onToggleHide: (e: React.MouseEvent) => void;
  onShowInfo: (e: React.MouseEvent) => void;
}

/**
 * Hover-overlay для строки ветки (Fork-style). Четыре иконки в одном ряду:
 * pin / solo / hide / info. Active-state (например, ветка уже pinned)
 * визуально подсвечен и показан всегда — даже без hover, чтобы юзер видел,
 * какие ветки сейчас участвуют в графе. Inactive — только при hover/focus.
 */
const IconPin = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="8" x2="6" y2="11" />
    <path d="M3 8h6L8 4.5V1.5H4v3L3 8z" />
  </svg>
);

const IconFilter = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 2h10L7.5 6v4L4.5 11V6L1 2z" />
  </svg>
);

const IconEyeOff = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 1.5l9 9" />
    <path d="M3.2 4.8C2.2 5.4 1 6 1 6s2 3 5 3c.8 0 1.5-.2 2.1-.5" />
    <path d="M9.5 7.9C10.5 7 11 6 11 6s-2-3-5-3c-.4 0-.8.05-1.1.14" />
  </svg>
);

const IconInfo = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="5" />
    <line x1="6" y1="5.5" x2="6" y2="9" />
    <circle cx="6" cy="3.5" r="0.01" fill="currentColor" />
  </svg>
);

function BranchHoverActions({
  loc, isPinned, isHidden, isSolo, noteText,
  onTogglePin, onToggleSolo, onToggleHide, onShowInfo,
}: BranchHoverActionsProps) {
  const hasNote = noteText.trim().length > 0;
  const tooltipText = hasNote
    ? truncateNote(noteText)
    : loc.sidebar.branchNoteEmpty;

  return (
    <span className={s.branchActions} role="group">
      <button
        type="button"
        className={`${s.branchActionBtn} ${isPinned ? s.branchActionActive : ''}`}
        onClick={onTogglePin}
        title={isPinned ? loc.sidebar.unpinBranch : loc.sidebar.pinBranch}
        aria-pressed={isPinned}
      ><IconPin /></button>
      <button
        type="button"
        className={`${s.branchActionBtn} ${isSolo ? s.branchActionActive : ''}`}
        onClick={onToggleSolo}
        title={isSolo ? loc.sidebar.clearGraphFilter : loc.sidebar.soloGraph}
        aria-pressed={isSolo}
      ><IconFilter /></button>
      <button
        type="button"
        className={`${s.branchActionBtn} ${isHidden ? s.branchActionActive : ''}`}
        onClick={onToggleHide}
        title={isHidden ? loc.sidebar.unhideBranch : loc.sidebar.hideBranch}
        aria-pressed={isHidden}
      ><IconEyeOff /></button>
      <SgTooltip text={tooltipText} position="right" maxWidth={280}>
        <button
          type="button"
          className={`${s.branchActionBtn} ${hasNote ? s.branchActionFilled : ''}`}
          onClick={onShowInfo}
          aria-label={loc.sidebar.branchNote}
          aria-pressed={hasNote}
        ><IconInfo /></button>
      </SgTooltip>
    </span>
  );
}

function truncateNote(text: string): string {
  const t = text.trim();
  if (t.length <= NOTE_PREVIEW_MAX) return t;
  return `${t.slice(0, NOTE_PREVIEW_MAX)}…`;
}
