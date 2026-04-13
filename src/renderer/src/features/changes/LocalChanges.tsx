import { useCallback, useMemo } from 'react';
import { t, tpl } from '../../i18n';
import { postCommand } from '../../api';
import type { FileStatus } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import type { ShowPrompt } from '../graph/commitMenuItems';
import { buildFileTree, FileTreeItem, fileName } from './FileTree';
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
  showPrompt?: ShowPrompt;
  activePath?: string;
}

export function LocalChanges({ stagedFiles, unstagedFiles, mergeInProgress, onContextMenu, onOpenDiff, onFileHistory, onFileBlame, onOpenMergeEditor, showPrompt, activePath }: Props) {
  const loc = t();

  const conflictFiles = useMemo(() => unstagedFiles.filter(f => f.status === 'U'), [unstagedFiles]);
  const normalUnstaged = useMemo(() => unstagedFiles.filter(f => f.status !== 'U'), [unstagedFiles]);

  const getStagedMenuItems = useCallback((file: FileStatus): SgContextMenuItem[] => [
    { label: loc.contextMenu.unstage, action: () => postCommand({ type: 'unstageFile', file: file.path }) },
    { divider: true },
    { label: loc.contextMenu.openFile, action: () => postCommand({ type: 'openFile', file: file.path }) },
    { label: loc.contextMenu.openDiff, action: () => onOpenDiff ? onOpenDiff(file.path, 'STAGED') : postCommand({ type: 'openDiff', file: file.path, hash: 'STAGED' }) },
    { label: loc.contextMenu.fileHistory, action: () => onFileHistory?.(file.path) },
    { label: loc.contextMenu.blame, action: () => onFileBlame?.(file.path) },
    { divider: true },
    { label: loc.contextMenu.copyPath, action: () => navigator.clipboard.writeText(file.path) },
    { label: loc.contextMenu.copyFileName, action: () => navigator.clipboard.writeText(fileName(file.path)) },
  ], [loc, onFileHistory, onFileBlame, onOpenDiff]);

  const getUnstagedMenuItems = useCallback((file: FileStatus): SgContextMenuItem[] => {
    const items: SgContextMenuItem[] = [
      { label: loc.contextMenu.stage, action: () => postCommand({ type: 'stageFile', file: file.path }) },
      { divider: true },
      { label: loc.contextMenu.openFile, action: () => postCommand({ type: 'openFile', file: file.path }) },
      { label: loc.contextMenu.openDiff, action: () => onOpenDiff ? onOpenDiff(file.path, 'WORKING') : postCommand({ type: 'openDiff', file: file.path, hash: 'WORKING' }) },
      { label: loc.contextMenu.fileHistory, action: () => onFileHistory?.(file.path) },
      { label: loc.contextMenu.blame, action: () => onFileBlame?.(file.path) },
    ];
    if (file.status !== '?' && file.status !== 'U') {
      items.push({ divider: true }, {
        label: loc.contextMenu.discard,
        danger: true,
        action: () => showPrompt
          ? showPrompt({
              title: loc.dialog.discardTitle,
              message: tpl(loc.dialog.discardMessage, { file: file.path }),
              confirmLabel: loc.contextMenu.discard,
              danger: true,
              onConfirm: () => postCommand({ type: 'discardFileChanges', file: file.path }),
            })
          : postCommand({ type: 'discardFileChanges', file: file.path }),
      });
    }
    if (file.status === '?') {
      items.push({ divider: true }, {
        label: loc.contextMenu.discard,
        danger: true,
        action: () => showPrompt
          ? showPrompt({
              title: loc.dialog.discardTitle,
              message: tpl(loc.dialog.discardMessage, { file: file.path }),
              confirmLabel: loc.dialog.delete,
              danger: true,
              onConfirm: () => postCommand({ type: 'deleteUntrackedFile', file: file.path }),
            })
          : postCommand({ type: 'deleteUntrackedFile', file: file.path }),
      });
    }
    items.push(
      { divider: true },
      { label: loc.contextMenu.copyPath, action: () => navigator.clipboard.writeText(file.path) },
      { label: loc.contextMenu.copyFileName, action: () => navigator.clipboard.writeText(fileName(file.path)) },
    );
    return items;
  }, [loc, onFileHistory, onFileBlame, onOpenDiff, showPrompt]);

  const getConflictMenuItems = useCallback((file: FileStatus): SgContextMenuItem[] => [
    { label: loc.contextMenu.openMergeEditor, action: () => onOpenMergeEditor?.(file.path) },
    { divider: true },
    { label: loc.contextMenu.resolveOurs, action: () => postCommand({ type: 'resolveWithOurs', file: file.path }) },
    { label: loc.contextMenu.resolveTheirs, action: () => postCommand({ type: 'resolveWithTheirs', file: file.path }) },
    { divider: true },
    { label: loc.contextMenu.copyPath, action: () => navigator.clipboard.writeText(file.path) },
    { label: loc.contextMenu.copyFileName, action: () => navigator.clipboard.writeText(fileName(file.path)) },
  ], [loc, onOpenMergeEditor]);

  const handleStageAll = () => {
    const files = normalUnstaged.map(f => f.path);
    if (files.length > 0) postCommand({ type: 'stageAll', files });
  };
  const handleUnstageAll = () => { postCommand({ type: 'unstageAll', files: stagedFiles.map(f => f.path) }); };
  const handleDiscardAll = () => {
    const doDiscard = () => {
      for (const f of normalUnstaged) {
        if (f.status !== '?') postCommand({ type: 'discardFileChanges', file: f.path });
      }
    };
    if (showPrompt) {
      showPrompt({
        title: loc.dialog.discardTitle,
        message: loc.dialog.resetHardMessage,
        confirmLabel: loc.changes.discardAll,
        danger: true,
        onConfirm: doDiscard,
      });
    } else {
      doDiscard();
    }
  };

  const unstagedTree = useMemo(() => buildFileTree(normalUnstaged), [normalUnstaged]);
  const stagedTree = useMemo(() => buildFileTree(stagedFiles), [stagedFiles]);

  const handleUnstagedClick = useCallback((file: FileStatus) => {
    if (onOpenDiff) onOpenDiff(file.path, 'WORKING');
    else postCommand({ type: 'openDiff', file: file.path, hash: 'WORKING' });
  }, [onOpenDiff]);

  const handleConflictClick = useCallback((file: FileStatus) => {
    if (onOpenMergeEditor) onOpenMergeEditor(file.path);
  }, [onOpenMergeEditor]);

  const handleStagedClick = useCallback((file: FileStatus) => {
    if (onOpenDiff) onOpenDiff(file.path, 'STAGED');
    else postCommand({ type: 'openDiff', file: file.path, hash: 'STAGED' });
  }, [onOpenDiff]);

  if (stagedFiles.length === 0 && unstagedFiles.length === 0) {
    return <div className={`${s.root} ${s.empty}`}><p>{loc.changes.noChanges}</p></div>;
  }

  return (
    <div className={s.root}>
      {mergeInProgress && conflictFiles.length > 0 && (
        <div className={s.section}>
          <div className={`${s.sectionHeader} ${s.sectionHeaderConflict}`}>
            <span className={s.sectionTitle}>⚠ {loc.changes.conflicts} ({conflictFiles.length})</span>
          </div>
          <div className={s.fileList}>
            {conflictFiles.map(file => (
              <div key={file.path}
                className={`${s.fileItem} ${s.fileItemConflict} ${activePath === file.path ? s.fileItemActive : ''}`}
                onClick={() => handleConflictClick(file)}
                onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getConflictMenuItems(file)); }}>
                <span className={`${s.statusIcon} ${s.statusConflict}`}>!</span>
                <span className={s.fileName}>{file.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={s.section}>
        <div className={s.sectionHeader}>
          <span className={s.sectionTitle}>{loc.changes.unstaged} ({normalUnstaged.length})</span>
          <div className={s.sectionActions}>
            {normalUnstaged.some(f => f.status !== '?') && (
              <button className={`${s.sectionAction} ${s.sectionActionDanger}`} onClick={handleDiscardAll} title={loc.changes.discardAll}>✕</button>
            )}
            {normalUnstaged.length > 0 && (
              <button className={s.sectionAction} onClick={handleStageAll} title={loc.changes.stageAll}>{loc.contextMenu.stage}</button>
            )}
          </div>
        </div>
        <div className={s.fileList}>
          {unstagedTree.map(node => (
            <FileTreeItem key={node.path} node={node} depth={0} activePath={activePath}
              onClickFile={handleUnstagedClick}
              onDoubleClickFile={(file) => postCommand({ type: 'stageFile', file: file.path })}
              onDoubleClickFolder={(files) => postCommand({ type: 'stageAll', files: files.map(f => f.path) })}
              onContextMenu={(e, file) => onContextMenu(e, getUnstagedMenuItems(file))} />
          ))}
        </div>
      </div>

      <div className={s.section}>
        <div className={s.sectionHeader}>
          <span className={s.sectionTitle}>{loc.changes.staged} ({stagedFiles.length})</span>
          {stagedFiles.length > 0 && (
            <button className={s.sectionAction} onClick={handleUnstageAll} title={loc.changes.unstageAll}>{loc.contextMenu.unstage}</button>
          )}
        </div>
        <div className={s.fileList}>
          {stagedTree.map(node => (
            <FileTreeItem key={node.path} node={node} depth={0} activePath={activePath}
              onClickFile={handleStagedClick}
              onDoubleClickFile={(file) => postCommand({ type: 'unstageFile', file: file.path })}
              onDoubleClickFolder={(files) => postCommand({ type: 'unstageAll', files: files.map(f => f.path) })}
              onContextMenu={(e, file) => onContextMenu(e, getStagedMenuItems(file))} />
          ))}
        </div>
      </div>
    </div>
  );
}
