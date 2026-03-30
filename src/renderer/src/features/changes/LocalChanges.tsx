import { useCallback, useState, useMemo } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import type { FileStatus } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import s from './LocalChanges.module.css';

interface Props {
  stagedFiles: FileStatus[];
  unstagedFiles: FileStatus[];
  mergeInProgress?: boolean;
  onContextMenu: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
  onOpenDiff?: (file: string, hash: string) => void;
  onFileHistory?: (file: string) => void;
  onFileBlame?: (file: string) => void;
  onOpenMergeEditor?: (file: string) => void;
  activePath?: string;
}

function statusIcon(status: string): string {
  switch (status) {
    case 'M': return 'M';
    case 'A': return 'A';
    case 'D': return 'D';
    case 'R': return 'R';
    case 'U': return '!';
    case '?': return '?';
    default: return '?';
  }
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

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

function dirName(path: string): string {
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
}

interface FileTreeNode {
  name: string;
  path: string;
  file: FileStatus | null;
  children: FileTreeNode[];
}

function buildFileTree(files: FileStatus[]): FileTreeNode[] {
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

function FileTreeItem({ node, depth, activePath, onClickFile, onContextMenu }: {
  node: FileTreeNode; depth: number; activePath?: string;
  onClickFile: (file: FileStatus) => void;
  onContextMenu: (e: React.MouseEvent, file: FileStatus) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isDir = node.children.length > 0 && !node.file;
  const paddingLeft = 12 + depth * 16;

  if (isDir) {
    return (
      <>
        <div className={s.treeFolder} style={{ paddingLeft }} onClick={() => setExpanded(e => !e)}>
          <span className={`${s.treeArrow} ${expanded ? s.treeArrowExpanded : ''}`}>&#9656;</span>
          <span className={s.treeFolderIcon}>📁</span>
          <span className={s.treeFolderName}>{node.name}</span>
        </div>
        {expanded && node.children.map(child => (
          <FileTreeItem key={child.path} node={child} depth={depth + 1} activePath={activePath} onClickFile={onClickFile} onContextMenu={onContextMenu} />
        ))}
      </>
    );
  }

  if (node.file) {
    const file = node.file;
    return (
      <div
        className={`${s.fileItem} ${file.status === 'U' ? s.fileItemConflict : ''} ${activePath === file.path ? s.fileItemActive : ''}`}
        style={{ paddingLeft }}
        onClick={() => onClickFile(file)}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, file); }}
      >
        <span className={`${s.statusIcon} ${statusCls(file.status)}`}>{statusIcon(file.status)}</span>
        <span className={s.fileName}>{node.name}</span>
      </div>
    );
  }

  return null;
}

export function LocalChanges({ stagedFiles, unstagedFiles, mergeInProgress, onContextMenu, onOpenDiff, onFileHistory, onFileBlame, onOpenMergeEditor, activePath }: Props) {
  const loc = t();

  const getStagedMenuItems = useCallback((file: FileStatus): SgContextMenuItem[] => [
    { label: loc.contextMenu.unstage, action: () => postCommand({ type: 'unstageFile', file: file.path }) },
    { divider: true },
    { label: loc.contextMenu.openFile, action: () => postCommand({ type: 'openFile', file: file.path }) },
    { label: loc.contextMenu.openDiff, action: () => postCommand({ type: 'openDiff', file: file.path, hash: 'HEAD' }) },
    { label: 'File History', action: () => onFileHistory?.(file.path) },
    { label: 'Blame', action: () => onFileBlame?.(file.path) },
    { divider: true },
    { label: loc.contextMenu.copyPath, action: () => navigator.clipboard.writeText(file.path) },
    { label: loc.contextMenu.copyFileName, action: () => navigator.clipboard.writeText(fileName(file.path)) },
  ], [loc, onFileHistory, onFileBlame]);

  const getUnstagedMenuItems = useCallback((file: FileStatus): SgContextMenuItem[] => {
    const items: SgContextMenuItem[] = [
      { label: loc.contextMenu.stage, action: () => postCommand({ type: 'stageFile', file: file.path }) },
      { divider: true },
      { label: loc.contextMenu.openFile, action: () => postCommand({ type: 'openFile', file: file.path }) },
      { label: loc.contextMenu.openDiff, action: () => postCommand({ type: 'openDiff', file: file.path, hash: 'HEAD' }) },
      { label: 'File History', action: () => onFileHistory?.(file.path) },
      { label: 'Blame', action: () => onFileBlame?.(file.path) },
    ];
    if (file.status === 'U') {
      items.push(
        { divider: true },
        { label: loc.contextMenu.openMergeEditor, action: () => postCommand({ type: 'openMergeEditor', file: file.path }) },
        { label: loc.contextMenu.resolveOurs, action: () => postCommand({ type: 'resolveWithOurs', file: file.path }) },
        { label: loc.contextMenu.resolveTheirs, action: () => postCommand({ type: 'resolveWithTheirs', file: file.path }) },
      );
    }
    if (file.status !== '?' && file.status !== 'U') {
      items.push({ divider: true }, { label: loc.contextMenu.discard, danger: true, action: () => postCommand({ type: 'discardFileChanges', file: file.path }) });
    }
    items.push(
      { divider: true },
      { label: loc.contextMenu.copyPath, action: () => navigator.clipboard.writeText(file.path) },
      { label: loc.contextMenu.copyFileName, action: () => navigator.clipboard.writeText(fileName(file.path)) },
    );
    return items;
  }, [loc, onFileHistory, onFileBlame]);

  const handleStageAll = () => { for (const f of unstagedFiles) postCommand({ type: 'stageFile', file: f.path }); };
  const handleUnstageAll = () => { for (const f of stagedFiles) postCommand({ type: 'unstageFile', file: f.path }); };
  const handleDiscardAll = () => {
    for (const f of unstagedFiles) {
      if (f.status !== '?' && f.status !== 'U') postCommand({ type: 'discardFileChanges', file: f.path });
    }
  };

  const conflicts = unstagedFiles.filter(f => f.status === 'U');

  const unstagedTree = useMemo(() => buildFileTree(unstagedFiles), [unstagedFiles]);
  const stagedTree = useMemo(() => buildFileTree(stagedFiles), [stagedFiles]);

  const handleUnstagedClick = useCallback((file: FileStatus) => {
    if (file.status === 'U' && onOpenMergeEditor) onOpenMergeEditor(file.path);
    else if (onOpenDiff) onOpenDiff(file.path, 'WORKING');
    else postCommand({ type: 'openDiff', file: file.path, hash: 'HEAD' });
  }, [onOpenDiff, onOpenMergeEditor]);

  const handleStagedClick = useCallback((file: FileStatus) => {
    if (onOpenDiff) onOpenDiff(file.path, 'STAGED');
    else postCommand({ type: 'openDiff', file: file.path, hash: 'HEAD' });
  }, [onOpenDiff]);

  if (stagedFiles.length === 0 && unstagedFiles.length === 0) {
    return <div className={`${s.root} ${s.empty}`}><p>{loc.changes.noChanges}</p></div>;
  }

  return (
    <div className={s.root}>
      {mergeInProgress && conflicts.length > 0 && (
        <div className={s.conflictBanner}>
          ⚠ {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''} — resolve before committing
        </div>
      )}

      {/* Unstaged */}
      <div className={s.section}>
        <div className={s.sectionHeader}>
          <span className={s.sectionTitle}>{loc.changes.unstaged} ({unstagedFiles.length})</span>
          <div className={s.sectionActions}>
            {unstagedFiles.some(f => f.status !== '?' && f.status !== 'U') && (
              <button className={`${s.sectionAction} ${s.sectionActionDanger}`} onClick={handleDiscardAll} title="Discard All">✕</button>
            )}
            {unstagedFiles.length > 0 && (
              <button className={s.sectionAction} onClick={handleStageAll} title={loc.changes.stageAll}>Stage</button>
            )}
          </div>
        </div>
        <div className={s.fileList}>
          {unstagedTree.map(node => (
            <FileTreeItem
              key={node.path}
              node={node}
              depth={0}
              activePath={activePath}
              onClickFile={handleUnstagedClick}
              onContextMenu={(e, file) => onContextMenu(e, getUnstagedMenuItems(file))}
            />
          ))}
        </div>
      </div>

      {/* Staged */}
      <div className={s.section}>
        <div className={s.sectionHeader}>
          <span className={s.sectionTitle}>{loc.changes.staged} ({stagedFiles.length})</span>
          {stagedFiles.length > 0 && (
            <button className={s.sectionAction} onClick={handleUnstageAll} title={loc.changes.unstageAll}>Unstage</button>
          )}
        </div>
        <div className={s.fileList}>
          {stagedTree.map(node => (
            <FileTreeItem
              key={node.path}
              node={node}
              depth={0}
              activePath={activePath}
              onClickFile={handleStagedClick}
              onContextMenu={(e, file) => onContextMenu(e, getStagedMenuItems(file))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
