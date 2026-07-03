import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileStatus } from '../../types';
import { t } from '../../i18n';
import { statusIcon, statusCls } from './FileTree';
import {
  collectFiles, collectFolderPaths, flattenTree,
  type FileTreeNode,
} from './fileTreeModel';
import { useVirtualList } from './useVirtualList';
import s from './LocalChanges.module.css';

/** Высота строки списка (px). Фиксированная — обязательна для виртуализации. */
export const TREE_ROW_HEIGHT = 24;

interface Props {
  tree: FileTreeNode[];
  section: 'unstaged' | 'staged';
  /** Ключ области (repoPath+секция): по смене — сброс состояния свёрнутости. */
  scopeKey: string;
  /** true → стартуем со свёрнутыми папками (защита от разовой тяжёлой отрисовки). */
  collapseByDefault: boolean;
  activePath?: string;
  activeSection?: 'unstaged' | 'staged' | 'conflict';
  focusedPath?: string | null;
  onClickFile: (file: FileStatus) => void;
  onClickFolder?: (folderPath: string) => void;
  onDoubleClickFile?: (file: FileStatus) => void;
  onDoubleClickFolder?: (files: FileStatus[]) => void;
  onContextMenu: (e: React.MouseEvent, file: FileStatus) => void;
  onContextMenuFolder?: (e: React.MouseEvent, node: FileTreeNode) => void;
}

export function VirtualFileTree({
  tree, section, scopeKey, collapseByDefault,
  activePath, activeSection, focusedPath,
  onClickFile, onClickFolder, onDoubleClickFile, onDoubleClickFolder,
  onContextMenu, onContextMenuFolder,
}: Props) {
  const loc = t();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Инициализация свёрнутости один раз на scopeKey (репо+секция). При смене
  // репо сбрасываем; в рамках одного репо состояние переживает refresh'ы.
  const initedScopeRef = useRef<string | null>(null);
  useEffect(() => {
    if (initedScopeRef.current === scopeKey) return;
    initedScopeRef.current = scopeKey;
    setCollapsed(collapseByDefault ? new Set(collectFolderPaths(tree)) : new Set());
  }, [scopeKey, collapseByDefault, tree]);

  const toggleFolder = useCallback((path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  const { bodyRef, range } = useVirtualList(rows.length, TREE_ROW_HEIGHT);

  const visible = rows.slice(range.start, range.end);

  return (
    <div ref={bodyRef} className={s.fileList}>
      <div style={{ height: rows.length * TREE_ROW_HEIGHT, position: 'relative' }}>
        {visible.map((row, i) => {
          const absIndex = range.start + i;
          const top = absIndex * TREE_ROW_HEIGHT;
          const paddingLeft = 12 + row.depth * 16;
          const node = row.node;

          if (row.isDir) {
            const isActive = activePath === node.path && activeSection === section;
            const expanded = !collapsed.has(node.path);
            return (
              <div
                key={node.path}
                className={`${s.treeFolder} ${isActive ? s.fileItemActive : ''}`}
                style={{ position: 'absolute', top, left: 0, right: 0, height: TREE_ROW_HEIGHT, boxSizing: 'border-box', paddingLeft }}
                onContextMenu={onContextMenuFolder ? (e) => { e.preventDefault(); e.stopPropagation(); onContextMenuFolder(e, node); } : undefined}
              >
                <span
                  className={`${s.treeArrow} ${expanded ? s.treeArrowExpanded : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleFolder(node.path); }}
                >&#9656;</span>
                <span
                  className={s.treeFolderBody}
                  onClick={() => onClickFolder?.(node.path)}
                  onDoubleClick={() => onDoubleClickFolder?.(collectFiles(node))}
                >
                  <span className={s.treeFolderIcon}>📁</span>
                  <span className={s.treeFolderName}>{node.name}</span>
                </span>
              </div>
            );
          }

          const file = node.file;
          if (!file) return null;
          const isFileActive = activePath === file.path && activeSection === section;
          const isFocused = focusedPath === file.path;
          const isStatDirty = file.statDirty === true;
          return (
            <div
              key={node.path}
              className={`${s.fileItem} ${file.status === 'U' ? s.fileItemConflict : ''} ${isFileActive ? s.fileItemActive : ''} ${isFocused ? s.fileItemFocused : ''}`}
              style={{ position: 'absolute', top, left: 0, right: 0, height: TREE_ROW_HEIGHT, boxSizing: 'border-box', paddingLeft, ...(isStatDirty ? { opacity: 0.55 } : null) }}
              title={isStatDirty ? loc.diff.statDirtyTooltip : undefined}
              onClick={() => onClickFile(file)}
              onDoubleClick={() => onDoubleClickFile?.(file)}
              onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, file); }}
            >
              <span className={s.treeArrowPlaceholder} aria-hidden="true" />
              <span className={`${s.statusIcon} ${statusCls(file.status)}`}>
                {isStatDirty ? '·' : statusIcon(file.status)}
              </span>
              <span className={s.fileName}>{node.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
