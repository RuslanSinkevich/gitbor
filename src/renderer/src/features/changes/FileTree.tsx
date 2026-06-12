import { useState } from 'react';
import type { FileStatus } from '../../types';
import { t } from '../../i18n';
import s from './LocalChanges.module.css';
import { collectFiles, type FileTreeNode } from './fileTreeModel';

export { buildFileTree, collectFiles, type FileTreeNode } from './fileTreeModel';

/* ─── Status helpers ─── */

/**
 * Глиф внутри цветного квадрата статуса. Для `+` и `−` отдаём SVG —
 * текстовые символы U+002B/U+2212 в большинстве шрифтов сидят на baseline
 * и визуально «плывут» вверх/вниз внутри квадрата. SVG центрируется
 * пиксель в пиксель независимо от шрифта.
 */
function statusIcon(status: string): string | JSX.Element {
  switch (status) {
    case 'M': return 'M';
    case 'A': return <PlusGlyph />;
    case 'D': return <MinusGlyph />;
    case 'R': return 'R';
    case 'U': return '!';
    case '?': return <PlusGlyph />;
    default: return '?';
  }
}

function PlusGlyph(): JSX.Element {
  return (
    <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M3.25 0.75h1.5v6.5h-1.5z M0.75 3.25h6.5v1.5h-6.5z" fill="currentColor" />
    </svg>
  );
}

function MinusGlyph(): JSX.Element {
  return (
    <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true">
      <rect x="0.75" y="3.25" width="6.5" height="1.5" fill="currentColor" />
    </svg>
  );
}

function statusCls(status: string): string {
  switch (status) {
    case 'M': return s.statusModified;
    case 'A': return s.statusAdded;
    case 'D': return s.statusDeleted;
    case 'R': return s.statusRenamed;
    case 'U': return s.statusConflict;
    case '?': return s.statusUntracked;
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
  section: 'unstaged' | 'staged';
  activePath?: string;
  activeSection?: 'unstaged' | 'staged' | 'conflict';
  focusedPath?: string | null;
  /** Снимок дерева коммита: показываем структуру без статус-иконок (нет diff-статуса). */
  plain?: boolean;
  /** Начальное состояние папок: changes раскрыты, полный snapshot стартует закрытым. */
  defaultExpanded?: boolean;
  onClickFile: (file: FileStatus) => void;
  onClickFolder?: (folderPath: string) => void;
  onDoubleClickFile?: (file: FileStatus) => void;
  onDoubleClickFolder?: (files: FileStatus[]) => void;
  onContextMenu: (e: React.MouseEvent, file: FileStatus) => void;
  onContextMenuFolder?: (e: React.MouseEvent, node: FileTreeNode) => void;
}

export function FileTreeItem({
  node, depth, section, activePath, activeSection, focusedPath, plain, defaultExpanded = true,
  onClickFile, onClickFolder, onDoubleClickFile, onDoubleClickFolder, onContextMenu, onContextMenuFolder,
}: FileTreeItemProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isDir = node.children.length > 0 && !node.file;
  const paddingLeft = 12 + depth * 16;
  const isActive = activePath === node.path && activeSection === section;

  if (isDir) {
    return (
      <>
        <div className={`${s.treeFolder} ${isActive ? s.fileItemActive : ''}`} style={{ paddingLeft }}
          onContextMenu={onContextMenuFolder ? (e) => { e.preventDefault(); e.stopPropagation(); onContextMenuFolder(e, node); } : undefined}>
          <span className={`${s.treeArrow} ${expanded ? s.treeArrowExpanded : ''}`}
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}>&#9656;</span>
          <span
            className={s.treeFolderBody}
            onClick={() => onClickFolder?.(node.path)}
            onDoubleClick={() => onDoubleClickFolder?.(collectFiles(node))}
          >
            <span className={s.treeFolderIcon}>📁</span>
            <span className={s.treeFolderName}>{node.name}</span>
          </span>
        </div>
        {expanded && node.children.map(child => (
          <FileTreeItem key={child.path} node={child} depth={depth + 1} section={section} activePath={activePath} activeSection={activeSection} focusedPath={focusedPath} plain={plain} defaultExpanded={defaultExpanded}
            onClickFile={onClickFile} onClickFolder={onClickFolder} onDoubleClickFile={onDoubleClickFile}
            onDoubleClickFolder={onDoubleClickFolder} onContextMenu={onContextMenu} onContextMenuFolder={onContextMenuFolder} />
        ))}
      </>
    );
  }

  if (node.file) {
    const file = node.file;
    const isFocused = focusedPath === file.path;
    const isFileActive = activePath === file.path && activeSection === section;
    const isStatDirty = file.statDirty === true;
    const loc = t();
    return (
      <div
        className={`${s.fileItem} ${file.status === 'U' ? s.fileItemConflict : ''} ${isFileActive ? s.fileItemActive : ''} ${isFocused ? s.fileItemFocused : ''}`}
        style={{ paddingLeft, ...(isStatDirty ? { opacity: 0.55 } : null) }}
        title={isStatDirty ? loc.diff.statDirtyTooltip : undefined}
        onClick={() => onClickFile(file)}
        onDoubleClick={() => onDoubleClickFile?.(file)}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, file); }}
      >
        {/* Spacer той же ширины, что arrow у папок: без него имена файлов и
            папок на одном уровне депта оказываются на разных x-координатах,
            и файлы визуально «торчат» влево от папок-сиблингов. */}
        <span className={s.treeArrowPlaceholder} aria-hidden="true" />
        {!plain && (
          <span className={`${s.statusIcon} ${statusCls(file.status)}`}>
            {isStatDirty ? '·' : statusIcon(file.status)}
          </span>
        )}
        <span className={s.fileName}>{node.name}</span>
      </div>
    );
  }

  return null;
}
