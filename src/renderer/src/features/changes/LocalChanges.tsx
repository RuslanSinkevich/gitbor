import { useCallback, useMemo } from 'react';
import { t, tpl } from '../../i18n';
import { postCommand, copyToClipboard } from '../../api';
import type { FileStatus } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { SgSplitPane } from '../../ui/SgSplitPane';
import { buildStorageKey } from '../../shared/uiPersist';
import type { ShowPrompt } from '../graph/commitMenuItems';
import { buildFileTree, FileTreeItem, fileName, collectFiles, type FileTreeNode } from './FileTree';
import { useFileListKeyboard } from './useFileListKeyboard';
import s from './LocalChanges.module.css';

interface Props {
  repoPath: string;
  stagedFiles: FileStatus[];
  unstagedFiles: FileStatus[];
  /** Раньше определял, показывать ли блок Conflicts. Теперь UU всегда видны (см. блок 18) — пропс оставлен для backward-compat и игнорируется. */
  mergeInProgress?: boolean;
  onContextMenu: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
  onOpenDiff?: (file: string, hash: string) => void;
  onFileHistory?: (file: string) => void;
  onFileBlame?: (file: string) => void;
  onOpenMergeEditor?: (file: string) => void;
  onSelectFolder?: (folderPath: string, section: 'unstaged' | 'staged') => void;
  showPrompt?: ShowPrompt;
  activePath?: string;
  activeSection?: 'unstaged' | 'staged' | 'conflict';
}

export function LocalChanges({
  repoPath,
  stagedFiles, unstagedFiles, onContextMenu, onOpenDiff, onFileHistory, onFileBlame,
  onOpenMergeEditor, onSelectFolder, showPrompt, activePath, activeSection,
}: Props) {
  const loc = t();
  const stagedSplitStorageKey = buildStorageKey('sg-layout:changes-staged-height', repoPath);

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
    { label: loc.contextMenu.copyPath, action: () => copyToClipboard(file.path) },
    { label: loc.contextMenu.copyFileName, action: () => copyToClipboard(fileName(file.path)) },
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
              kind: 'confirm',
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
              kind: 'confirm',
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
      { label: loc.contextMenu.copyPath, action: () => copyToClipboard(file.path) },
      { label: loc.contextMenu.copyFileName, action: () => copyToClipboard(fileName(file.path)) },
    );
    return items;
  }, [loc, onFileHistory, onFileBlame, onOpenDiff, showPrompt]);

  const getConflictMenuItems = useCallback((file: FileStatus): SgContextMenuItem[] => [
    { label: loc.contextMenu.openMergeEditor, action: () => onOpenMergeEditor?.(file.path) },
    { divider: true },
    { label: loc.contextMenu.resolveOurs, action: () => postCommand({ type: 'resolveWithOurs', file: file.path }) },
    { label: loc.contextMenu.resolveTheirs, action: () => postCommand({ type: 'resolveWithTheirs', file: file.path }) },
    { divider: true },
    { label: loc.contextMenu.copyPath, action: () => copyToClipboard(file.path) },
    { label: loc.contextMenu.copyFileName, action: () => copyToClipboard(fileName(file.path)) },
  ], [loc, onOpenMergeEditor]);

  const getUnstagedFolderMenuItems = useCallback((node: FileTreeNode): SgContextMenuItem[] => {
    const files = collectFiles(node);
    const filePaths = files.map(f => f.path);
    const trackedFiles = files.filter(f => f.status !== '?' && f.status !== 'U');
    const untrackedFiles = files.filter(f => f.status === '?');

    const items: SgContextMenuItem[] = [
      { header: true, label: tpl(loc.contextMenu.folder.header, { name: node.name, count: String(files.length) }) },
      { divider: true },
    ];
    if (filePaths.length > 0) {
      items.push({ label: loc.contextMenu.folder.stageAll, action: () => postCommand({ type: 'stageAll', files: filePaths }) });
    }
    if (trackedFiles.length > 0) {
      items.push({ divider: true }, {
        label: loc.contextMenu.folder.discardAll,
        danger: true,
        action: () => {
          const doDiscard = () => {
            postCommand({ type: 'discardFiles', files: trackedFiles.map(f => f.path) });
          };
          if (showPrompt) {
            showPrompt({
              kind: 'confirm',
              title: loc.dialog.discardTitle,
              message: tpl(loc.dialog.discardFolderMessage, { folder: node.path, count: String(trackedFiles.length) }),
              confirmLabel: loc.contextMenu.folder.discardAll,
              danger: true,
              onConfirm: doDiscard,
            });
          } else {
            doDiscard();
          }
        },
      });
    }
    if (untrackedFiles.length > 0) {
      items.push({ divider: true }, {
        label: loc.contextMenu.folder.deleteUntracked,
        danger: true,
        action: () => {
          const doDelete = () => {
            postCommand({ type: 'deleteUntrackedFiles', files: untrackedFiles.map(f => f.path) });
          };
          if (showPrompt) {
            showPrompt({
              kind: 'confirm',
              title: loc.dialog.discardTitle,
              message: tpl(loc.dialog.deleteUntrackedFolderMessage, { folder: node.path, count: String(untrackedFiles.length) }),
              confirmLabel: loc.dialog.delete,
              danger: true,
              onConfirm: doDelete,
            });
          } else {
            doDelete();
          }
        },
      });
    }
    items.push(
      { divider: true },
      { label: loc.contextMenu.folder.copyPath, action: () => copyToClipboard(node.path) },
    );
    return items;
  }, [loc, showPrompt]);

  const getStagedFolderMenuItems = useCallback((node: FileTreeNode): SgContextMenuItem[] => {
    const files = collectFiles(node);
    const filePaths = files.map(f => f.path);
    const items: SgContextMenuItem[] = [
      { header: true, label: tpl(loc.contextMenu.folder.header, { name: node.name, count: String(files.length) }) },
      { divider: true },
    ];
    if (filePaths.length > 0) {
      items.push({ label: loc.contextMenu.folder.unstageAll, action: () => postCommand({ type: 'unstageAll', files: filePaths }) });
    }
    items.push(
      { divider: true },
      { label: loc.contextMenu.folder.copyPath, action: () => copyToClipboard(node.path) },
    );
    return items;
  }, [loc]);

  const handleStageAll = () => {
    const files = normalUnstaged.map(f => f.path);
    if (files.length > 0) postCommand({ type: 'stageAll', files });
  };
  const handleUnstageAll = () => { postCommand({ type: 'unstageAll', files: stagedFiles.map(f => f.path) }); };
  const handleDiscardAll = () => {
    const doDiscard = () => {
      const tracked = normalUnstaged.filter(f => f.status !== '?').map(f => f.path);
      if (tracked.length > 0) postCommand({ type: 'discardFiles', files: tracked });
    };
    if (showPrompt) {
      showPrompt({
        kind: 'confirm',
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

  // Конфликтные файлы (UU) показываем ВСЕГДА, даже если backend не
  // выставил mergeInProgress: бывают повреждённые состояния (ручной
  // reset --keep / crash без MERGE_HEAD), где UU есть, а state-флаг
  // не подхватился. Без этого баннера нет, и юзер не видит конфликтов.
  const hasConflicts = conflictFiles.length > 0;

  const kbClickFile = useCallback((file: FileStatus, section: 'unstaged' | 'staged' | 'conflict') => {
    if (section === 'conflict') handleConflictClick(file);
    else if (section === 'unstaged') handleUnstagedClick(file);
    else handleStagedClick(file);
  }, [handleConflictClick, handleUnstagedClick, handleStagedClick]);

  const kbToggleStage = useCallback((file: FileStatus, section: 'unstaged' | 'staged' | 'conflict') => {
    if (section === 'unstaged') postCommand({ type: 'stageFile', file: file.path });
    else if (section === 'staged') postCommand({ type: 'unstageFile', file: file.path });
  }, []);

  const kb = useFileListKeyboard(normalUnstaged, stagedFiles, conflictFiles, hasConflicts, kbClickFile, kbToggleStage);

  if (stagedFiles.length === 0 && unstagedFiles.length === 0) {
    return <div className={`${s.root} ${s.empty}`}><p>{loc.changes.noChanges}</p></div>;
  }

  return (
    <div className={s.root} tabIndex={0} onKeyDown={kb.handleKeyDown}>
      <div className={s.mainSplit}>
        <SgSplitPane
          direction="vertical"
          defaultSize={280}
          minSize={120}
          maxSize={2000}
          minOpposite={100}
          storageKey={stagedSplitStorageKey}
          left={
            <div className={s.splitTopStack}>
              {conflictFiles.length > 0 && (
                <div className={`${s.section} ${s.sectionConflictCompact}`}>
                  <div className={`${s.sectionHeader} ${s.sectionHeaderConflict}`}>
                    <span className={s.sectionTitle}>⚠ {loc.changes.conflicts} ({conflictFiles.length})</span>
                  </div>
                  <div className={s.fileList}>
                    {conflictFiles.map(file => (
                      <div key={file.path}
                        className={`${s.fileItem} ${s.fileItemConflict} ${(activePath === file.path && activeSection === 'conflict') ? s.fileItemActive : ''} ${kb.focusedPath === file.path ? s.fileItemFocused : ''}`}
                        onClick={() => handleConflictClick(file)}
                        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getConflictMenuItems(file)); }}>
                        <span className={`${s.statusIcon} ${s.statusConflict}`}>!</span>
                        <span className={s.fileName}>{file.path}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={`${s.section} ${s.sectionUnstagedGrow}`}>
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
                    <FileTreeItem key={node.path} node={node} depth={0} section="unstaged" activePath={activePath} activeSection={activeSection} focusedPath={kb.focusedPath}
                      onClickFile={handleUnstagedClick}
                      onClickFolder={(folderPath) => onSelectFolder?.(folderPath, 'unstaged')}
                      onDoubleClickFile={(file) => postCommand({ type: 'stageFile', file: file.path })}
                      onDoubleClickFolder={(files) => postCommand({ type: 'stageAll', files: files.map(f => f.path) })}
                      onContextMenu={(e, file) => onContextMenu(e, getUnstagedMenuItems(file))}
                      onContextMenuFolder={(e, n) => onContextMenu(e, getUnstagedFolderMenuItems(n))} />
                  ))}
                </div>
              </div>
            </div>
          }
          right={
            <div className={s.splitBottomWrap}>
              <div className={s.section}>
                <div className={s.sectionHeader}>
                  <span className={s.sectionTitle}>{loc.changes.staged} ({stagedFiles.length})</span>
                  {stagedFiles.length > 0 && (
                    <button className={s.sectionAction} onClick={handleUnstageAll} title={loc.changes.unstageAll}>{loc.contextMenu.unstage}</button>
                  )}
                </div>
                <div className={s.fileList}>
                  {stagedTree.map(node => (
                    <FileTreeItem key={node.path} node={node} depth={0} section="staged" activePath={activePath} activeSection={activeSection} focusedPath={kb.focusedPath}
                      onClickFile={handleStagedClick}
                      onClickFolder={(folderPath) => onSelectFolder?.(folderPath, 'staged')}
                      onDoubleClickFile={(file) => postCommand({ type: 'unstageFile', file: file.path })}
                      onDoubleClickFolder={(files) => postCommand({ type: 'unstageAll', files: files.map(f => f.path) })}
                      onContextMenu={(e, file) => onContextMenu(e, getStagedMenuItems(file))}
                      onContextMenuFolder={(e, n) => onContextMenu(e, getStagedFolderMenuItems(n))} />
                  ))}
                </div>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
