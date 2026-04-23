import { useState } from 'react';
import { LocalChanges, CommitBar } from '../changes';
import { ConflictPanel } from '../merge';
import { RightPanelContent, type RightPanel } from './RightPanelContent';
import { SgSplitPane } from '../../ui/SgSplitPane';
import type { AppState, MergeState } from '../../types';
import type { t } from '../../i18n';
import s from '../../App.module.css';

interface Props {
  state: AppState;
  mergeState: MergeState | null;
  diffTarget: { file: string; hash: string } | null;
  rightPanel: RightPanel;
  setRightPanel: (p: RightPanel) => void;
  conflictFile: string | null;
  setConflictFile: (f: string | null) => void;
  setMergeEditorFile: (f: string | null) => void;
  showContextMenu: (e: React.MouseEvent, items: any[]) => void;
  openDiff: (file: string, hash: string) => void;
  closeDiff: () => void;
  openFileHistory: (file: string) => void;
  openFileBlame: (file: string) => void;
  handleOpenMergeEditor: (file: string) => void;
  handleConflictResolved: (resolvedPath: string) => void;
  selectCommit: (hash: string) => void;
  showPrompt: any;
  loc: ReturnType<typeof t>;
}

export function ChangesView({
  state, mergeState, diffTarget, rightPanel, setRightPanel,
  conflictFile, setConflictFile, setMergeEditorFile,
  showContextMenu, openDiff, closeDiff, openFileHistory, openFileBlame,
  handleOpenMergeEditor, handleConflictResolved, selectCommit,
  showPrompt, loc,
}: Props) {
  const [selectedFolder, setSelectedFolder] = useState<{ path: string; section: 'unstaged' | 'staged' } | null>(null);

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
      <SgSplitPane
        defaultSize={360}
        minSize={220}
        maxSize={720}
        minOpposite={280}
        left={
          <div className={s.changesFileListPane}>
            <LocalChanges
              unstagedFiles={state.unstagedFiles}
              stagedFiles={state.stagedFiles}
              mergeInProgress={mergeState?.inProgress}
              onContextMenu={showContextMenu}
              onOpenDiff={(f, h) => {
                setSelectedFolder(null);
                openDiff(f, h);
                setConflictFile(null);
                setMergeEditorFile(null);
                setRightPanel('diff');
              }}
              onFileHistory={openFileHistory}
              onFileBlame={(f) => openFileBlame(f)}
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
                  rightPanel={rightPanel}
                  setRightPanel={setRightPanel}
                  diffTarget={diffTarget}
                  selectCommit={selectCommit}
                  openDiff={openDiff}
                />
              ) : (
                <div className={s.emptyDiff}>{loc.details.selectCommit}</div>
              )}
            </div>
            <CommitBar stagedCount={state.stagedFiles.length} isOperationRunning={state.isOperationRunning} />
          </div>
        }
      />
    </div>
  );
}
