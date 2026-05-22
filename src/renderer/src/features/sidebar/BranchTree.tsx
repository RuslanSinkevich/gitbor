import { useState } from 'react';
import type { Branch } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { getBranchMenuItems } from './sidebarMenuItems';
import type { ShowPrompt } from '../graph/commitMenuItems';
import type { RequestCheckout } from '../checkout';
import type { t } from '../../i18n';
import s from './Sidebar.module.css';

/* ─── Tree node ─── */

export interface BranchTreeNode {
  segment: string;
  fullPath: string;
  branch: Branch | null;
  children: BranchTreeNode[];
}

export function buildBranchTree(branches: Branch[], stripPrefix = ''): BranchTreeNode[] {
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
  return sortBranchTreeNodes(root);
}

function sortBranchTreeNodes(nodes: BranchTreeNode[]): BranchTreeNode[] {
  const sortedChildren = nodes.map(node => ({
    ...node,
    children: sortBranchTreeNodes(node.children),
  }));

  return sortedChildren.sort((a, b) => {
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
}

export function BranchTreeItem({ node, depth, nested, currentBranch, loc, onContextMenu, onSelectRef, onMerge, showPrompt, requestCheckout, folderExpand }: BranchTreeItemProps) {
  const [expandedInternal, setExpandedInternal] = useState(() => node.branch?.isCurrent ? true : depth < 1);
  const expanded = folderExpand ? folderExpand.isExpanded(node.fullPath) : expandedInternal;
  const toggleExpanded = folderExpand
    ? () => folderExpand.toggle(node.fullPath)
    : () => setExpandedInternal(e => !e);

  const isFolder = node.children.length > 0;
  const branch = node.branch;
  const rowFolder = nested ? s.branchTreeFolderNested : s.branchTreeFolderRoot;
  const rowItem = nested ? s.branchTreeItemNested : s.branchTreeItemRoot;

  if (isFolder && !branch) {
    return (
      <>
        <div className={`${s.treeFolder} ${rowFolder}`} onClick={toggleExpanded}>
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
                onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} requestCheckout={requestCheckout} folderExpand={folderExpand} />
            ))}
          </div>
        )}
      </>
    );
  }

  if (branch) {
    return (
      <>
        <div className={`${s.item} ${rowItem} ${branch.isCurrent ? s.itemCurrent : ''}`}
          onClick={() => onSelectRef?.(branch.hash)}
          onDoubleClick={() => !branch.isCurrent && requestCheckout(branch.name)}
          onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getBranchMenuItems(branch, currentBranch, loc, showPrompt, requestCheckout, onMerge)); }}>
          <span className={s.itemName}>{node.segment}</span>
          {branch.isCurrent && <span className={s.itemBadge} title={loc.sidebar.current} aria-label={loc.sidebar.current} />}
          {branch.upstream && <span className={s.itemUpstream} title={branch.upstream}>↔</span>}
        </div>
        {node.children.length > 0 && expanded && (
          <div className={s.treeChildren}>
            {node.children.map(child => (
              <BranchTreeItem key={child.fullPath} node={child} depth={depth + 1} nested
                currentBranch={currentBranch} loc={loc} onContextMenu={onContextMenu}
                onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} requestCheckout={requestCheckout} folderExpand={folderExpand} />
            ))}
          </div>
        )}
      </>
    );
  }

  return null;
}
