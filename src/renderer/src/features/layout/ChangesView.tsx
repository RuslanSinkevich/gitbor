import { LocalChanges, CommitBar } from '../changes';
import { ConflictPanel } from '../merge';
import { RightPanelContent, type RightPanel } from './RightPanelContent';
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
  showContextMenu, openDiff, openFileHistory, openFileBlame,
  handleOpenMergeEditor, handleConflictResolved, selectCommit,
  showPrompt, loc,
}: Props) {
  return (
    <div className={s.changesLayout}>
      <div className={s.changesFileList}>
        <LocalChanges
          unstagedFiles={state.unstagedFiles}
          stagedFiles={state.stagedFiles}
          mergeInProgress={mergeState?.inProgress}
          onContextMenu={showContextMenu}
          onOpenDiff={(f, h) => { openDiff(f, h); setConflictFile(null); setMergeEditorFile(null); setRightPanel('diff'); }}
          onFileHistory={openFileHistory}
          onFileBlame={(f) => openFileBlame(f)}
          onOpenMergeEditor={handleOpenMergeEditor}
          showPrompt={showPrompt}
          activePath={conflictFile || diffTarget?.file}
        />
        <CommitBar stagedCount={state.stagedFiles.length} isOperationRunning={state.isOperationRunning} />
      </div>
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
    </div>
  );
}
