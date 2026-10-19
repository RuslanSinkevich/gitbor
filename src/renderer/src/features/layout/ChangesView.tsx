import { useState } from 'react';
import { LocalChanges, CommitBar } from '../changes';
import { GitignoreBanner } from '../gitignore';
import { ConflictPanel } from '../merge';
import { RightPanelContent } from './RightPanelContent';
import { SgSplitPane } from '../../ui/SgSplitPane';
import type { AppState, MergeState } from '../../types';
import type { t } from '../../i18n';
import type { ShowContextMenuFn } from '../../hooks/useContextMenu';
import type { ShowPromptFn } from '../../ui/SgPromptDialog';
import { buildStorageKey } from '../../shared/uiPersist';
import s from '../../App.module.css';

interface Props {
  state: AppState;
  mergeState: MergeState | null;
  diffTarget: { file: string; hash: string } | null;
  conflictFile: string | null;
  setConflictFile: (f: string | null) => void;
  setMergeEditorFile: (f: string | null) => void;
  showContextMenu: ShowContextMenuFn;
  openDiff: (file: string, hash: string) => void;
  closeDiff: () => void;
  handleOpenMergeEditor: (file: string) => void;
  handleConflictResolved: (resolvedPath: string) => void;
  showPrompt: ShowPromptFn;
  loc: ReturnType<typeof t>;
  onOpenAiSettings: () => void;
  onOpenGitignoreDialog?: () => void;
  onExpandDiff?: (file: string, hash: string) => void;
}

export function ChangesView({
  state, mergeState, diffTarget,
  conflictFile, setConflictFile, setMergeEditorFile,
  showContextMenu, openDiff, closeDiff,
  handleOpenMergeEditor, handleConflictResolved,
  showPrompt, loc, onOpenAiSettings, onOpenGitignoreDialog, onExpandDiff,
}: Props) {
  const [selectedFolder, setSelectedFolder] = useState<{ path: string; section: 'unstaged' | 'staged' } | null>(null);
  const fileListStorageKey = buildStorageKey('sg-layout:changes-file-list-width', state.repoPath);

  const activeSection: 'unstaged' | 'staged' | 'conflict' | undefined =
    selectedFolder
      ? selectedFolder.section
      : conflictFile
        ? 'conflict'
        : diffTarget?.hash === 'WORKING'
          ? 'unstaged'
          : diffTarget?.hash === 'STAGED'
            ? 'staged'
            : undefined;

  return (
    <div className={s.changesLayout}>
      {onOpenGitignoreDialog && (
        <GitignoreBanner repoPath={state.repoPath} onOpenDialog={onOpenGitignoreDialog} />
      )}
      <SgSplitPane
        defaultSize={360}
        minSize={220}
        maxSize={720}
        minOpposite={280}
        storageKey={fileListStorageKey}
        left={
          <div className={s.changesFileListPane}>
            <LocalChanges
              repoPath={state.repoPath}
              unstagedFiles={state.unstagedFiles}
              stagedFiles={state.stagedFiles}
              mergeInProgress={mergeState?.inProgress}
              conflictSides={mergeState?.inProgress ? { ours: mergeState.targetBranch, theirs: mergeState.sourceBranch } : undefined}
              onContextMenu={showContextMenu}
              onOpenDiff={(f, h) => {
                setSelectedFolder(null);
                openDiff(f, h);
                setConflictFile(null);
                setMergeEditorFile(null);
              }}
              onOpenMergeEditor={(f) => { setSelectedFolder(null); handleOpenMergeEditor(f); }}
              onSelectFolder={(folderPath, section) => {
                setSelectedFolder({ path: folderPath, section });
                setConflictFile(null);
                setMergeEditorFile(null);
                closeDiff();
              }}
              showPrompt={showPrompt}
              activePath={selectedFolder?.path || conflictFile || diffTarget?.file}
              activeSection={activeSection}
            />
          </div>
        }
        right={
          <div className={s.changesRightPane}>
            <div className={s.changesDiff}>
              {conflictFile && mergeState ? (
                <ConflictPanel
                  file={conflictFile}
                  mergeState={mergeState}
                  onOpenEditor={(f: string) => setMergeEditorFile(f)}
                  onResolved={() => handleConflictResolved(conflictFile)}
                />
              ) : diffTarget ? (
                <RightPanelContent
                  diffTarget={diffTarget}
                  onExpandDiff={onExpandDiff}
                />
              ) : (
                <div className={s.emptyDiff}>{loc.details.selectCommit}</div>
              )}
            </div>
            <CommitBar
              repoPath={state.repoPath}
              stagedCount={state.stagedFiles.length}
              isOperationRunning={state.isOperationRunning}
              onOpenAiSettings={onOpenAiSettings}
              mergeState={mergeState}
            />
          </div>
        }
      />
    </div>
  );
}
