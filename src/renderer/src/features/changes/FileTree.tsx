import { useState } from 'react';
import type { FileStatus } from '../../types';
import s from './LocalChanges.module.css';

/* ─── Tree node types ─── */

export interface FileTreeNode {
  name: string;
  path: string;
  file: FileStatus | null;
  children: FileTreeNode[];
}

/* ─── Build & collapse ─── */

export function buildFileTree(files: FileStatus[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      let existing = current.find(n => n.name === name);
      if (!existing) {
        existing = { name, path: parts.slice(0, i + 1).join('/'), file: isFile ? file : null, children: [] };
        current.push(existing);
      }
      if (isFile) existing.file = file;
      current = existing.children;
    }
  }
  return collapseSingleChild(root);
}

function collapseSingleChild(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.map(node => {
    node.children = collapseSingleChild(node.children);
    if (!node.file && node.children.length === 1) {
      const child = node.children[0];
      return { name: node.name + '/' + child.name, path: child.path, file: child.file, children: child.children };
    }
    return node;
  });
}

export function collectFiles(node: FileTreeNode): FileStatus[] {
  if (node.file) return [node.file];
  return node.children.flatMap(collectFiles);
}

/* ─── Status helpers ─── */

export function statusIcon(status: string): string {
  switch (status) {
    case 'M': return 'M'; case 'A': return 'A'; case 'D': return 'D';
    case 'R': return 'R'; case 'U': return '!'; case '?': return '?';
    default: return '?';
  }
}

export function statusCls(status: string): string {
  switch (status) {
    case 'M': return s.statusModified; case 'A': return s.statusAdded;
    case 'D': return s.statusDeleted; case 'R': return s.statusRenamed;
    case 'U': return s.statusConflict; case '?': return s.statusUntracked;
    default: return '';
  }
}

export function fileName(path: string): string {
  return path.split('/').pop() || path;
}

/* ─── FileTreeItem component ─── */

interface FileTreeItemProps {
  node: FileTreeNode;
  depth: number;
  activePath?: string;
  onClickFile: (file: FileStatus) => void;
  onDoubleClickFile?: (file: FileStatus) => void;
  onDoubleClickFolder?: (files: FileStatus[]) => void;
  onContextMenu: (e: React.MouseEvent, file: FileStatus) => void;
}

export function FileTreeItem({ node, depth, activePath, onClickFile, onDoubleClickFile, onDoubleClickFolder, onContextMenu }: FileTreeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const isDir = node.children.length > 0 && !node.file;
  const paddingLeft = 12 + depth * 16;

  if (isDir) {
    return (
      <>
        <div className={s.treeFolder} style={{ paddingLeft }}>
          <span className={`${s.treeArrow} ${expanded ? s.treeArrowExpanded : ''}`}
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}>&#9656;</span>
          <span className={s.treeFolderBody} onDoubleClick={() => onDoubleClickFolder?.(collectFiles(node))}>
            <span className={s.treeFolderIcon}>📁</span>
            <span className={s.treeFolderName}>{node.name}</span>
          </span>
        </div>
        {expanded && node.children.map(child => (
          <FileTreeItem key={child.path} node={child} depth={depth + 1} activePath={activePath}
            onClickFile={onClickFile} onDoubleClickFile={onDoubleClickFile}
            onDoubleClickFolder={onDoubleClickFolder} onContextMenu={onContextMenu} />
        ))}
      </>
    );
  }

  if (node.file) {
    const file = node.file;
    return (
      <div className={`${s.fileItem} ${file.status === 'U' ? s.fileItemConflict : ''} ${activePath === file.path ? s.fileItemActive : ''}`}
        style={{ paddingLeft }} onClick={() => onClickFile(file)}
        onDoubleClick={() => onDoubleClickFile?.(file)}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, file); }}>
        <span className={`${s.statusIcon} ${statusCls(file.status)}`}>{statusIcon(file.status)}</span>
        <span className={s.fileName}>{node.name}</span>
      </div>
    );
  }

  return null;
}
