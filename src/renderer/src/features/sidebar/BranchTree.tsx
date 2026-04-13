import { useState } from 'react';
import { postCommand } from '../../api';
import type { Branch } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { getBranchMenuItems } from './sidebarMenuItems';
import type { ShowPrompt } from '../graph/commitMenuItems';
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

  return collapseSingleChildFolders(root);
}

function collapseSingleChildFolders(nodes: BranchTreeNode[]): BranchTreeNode[] {
  return nodes.map(node => {
    node.children = collapseSingleChildFolders(node.children);
    if (!node.branch && node.children.length === 1) {
      const child = node.children[0];
      return { segment: node.segment + '/' + child.segment, fullPath: child.fullPath, branch: child.branch, children: child.children };
    }
    return node;
  });
}

export function countLeaves(node: BranchTreeNode): number {
  if (node.children.length === 0) return node.branch ? 1 : 0;
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0) + (node.branch ? 1 : 0);
}

/* ─── BranchTreeItem ─── */

interface BranchTreeItemProps {
  node: BranchTreeNode;
  depth: number;
  currentBranch: string;
  loc: ReturnType<typeof t>;
  onContextMenu: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
  onSelectRef?: (hash: string) => void;
  onMerge?: (source: string) => void;
  showPrompt: ShowPrompt;
}

export function BranchTreeItem({ node, depth, currentBranch, loc, onContextMenu, onSelectRef, onMerge, showPrompt }: BranchTreeItemProps) {
  const [expanded, setExpanded] = useState(() => node.branch?.isCurrent ? true : depth < 1);

  const isFolder = node.children.length > 0;
  const branch = node.branch;
  const paddingLeft = 28 + depth * 16;

  if (isFolder && !branch) {
    return (
      <>
        <div className={s.treeFolder} style={{ paddingLeft }} onClick={() => setExpanded(e => !e)}>
          <span className={`${s.arrow} ${expanded ? s.arrowExpanded : ''}`}>&#9656;</span>
          <span className={s.treeFolderIcon}>📁</span>
          <span className={s.treeFolderName}>{node.segment}</span>
          <span className={s.treeFolderCount}>{countLeaves(node)}</span>
        </div>
        {expanded && node.children.map(child => (
          <BranchTreeItem key={child.fullPath} node={child} depth={depth + 1}
            currentBranch={currentBranch} loc={loc} onContextMenu={onContextMenu}
            onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} />
        ))}
      </>
    );
  }

  if (branch) {
    return (
      <>
        <div className={`${s.item} ${branch.isCurrent ? s.itemCurrent : ''}`} style={{ paddingLeft }}
          onClick={() => onSelectRef?.(branch.hash)}
          onDoubleClick={() => !branch.isCurrent && postCommand({ type: 'checkout', branch: branch.name })}
          onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getBranchMenuItems(branch, currentBranch, loc, showPrompt, onMerge)); }}>
          <span className={s.itemName}>{node.segment}</span>
          {branch.isCurrent && <span className={s.itemBadge}>{loc.sidebar.current}</span>}
          {branch.upstream && <span className={s.itemUpstream} title={branch.upstream}>↔</span>}
        </div>
        {node.children.length > 0 && expanded && node.children.map(child => (
          <BranchTreeItem key={child.fullPath} node={child} depth={depth + 1}
            currentBranch={currentBranch} loc={loc} onContextMenu={onContextMenu}
            onSelectRef={onSelectRef} onMerge={onMerge} showPrompt={showPrompt} />
        ))}
      </>
    );
  }

  return null;
}
