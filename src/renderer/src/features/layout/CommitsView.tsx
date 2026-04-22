import { CommitGraph, CommitDetails } from '../graph';
import { RightPanelContent, type RightPanel } from './RightPanelContent';
import { postCommand } from '../../api';
import type { AppState, CommitDetail } from '../../types';
import s from '../../App.module.css';

interface Props {
  state: AppState;
  commitDetail: CommitDetail | null;
  diffTarget: { file: string; hash: string } | null;
  rightPanel: RightPanel;
  setRightPanel: (p: RightPanel) => void;
  selectCommit: (hash: string) => void;
  openDiff: (file: string, hash: string) => void;
  openFileHistory: (file: string) => void;
  openFileBlame: (file: string, hash?: string) => void;
  showContextMenu: (e: React.MouseEvent, items: any[]) => void;
  showPrompt: any;
  setRebaseOnto: (onto: string | null) => void;
  compareFrom?: string | null;
  onCompareFrom?: (hash: string) => void;
  onCompareTo?: (from: string, to: string) => void;
}

export function CommitsView({
  state, commitDetail, diffTarget, rightPanel, setRightPanel,
  selectCommit, openDiff, openFileHistory, openFileBlame,
  showContextMenu, showPrompt, setRebaseOnto,
  compareFrom, onCompareFrom, onCompareTo,
}: Props) {
  return (
    <div className={s.commitsLayout}>
      <div className={s.graphPane}>
        <CommitGraph
          commits={state.commits}
          graphNodes={state.graphLayout.nodes as any}
          maxColumns={state.graphLayout.maxColumns}
          mergeLinks={state.graphLayout.mergeLinks ?? []}
          selectedHash={state.selectedCommitHash}
          onSelect={selectCommit}
          currentBranch={state.currentBranch}
          onContextMenu={showContextMenu}
          showPrompt={showPrompt}
          onRebase={setRebaseOnto}
          onLoadMore={() => postCommand({ type: 'getGraphData', maxCount: state.commits.length + 50000 })}
          compareFrom={compareFrom}
          onCompareFrom={onCompareFrom}
          onCompareTo={onCompareTo}
        />
      </div>
      <div className={s.commitBottomPane}>
        <div className={s.detailPane}>
          <CommitDetails
            detail={commitDetail}
            onSelectCommit={selectCommit}
            onOpenDiff={openDiff}
            onContextMenu={showContextMenu}
            onFileHistory={openFileHistory}
            onFileBlame={(f) => openFileBlame(f)}
            activePath={diffTarget?.file}
          />
        </div>
        {diffTarget && (
          <div className={s.commitDiffPane}>
            <RightPanelContent
              rightPanel={rightPanel}
              setRightPanel={setRightPanel}
              diffTarget={diffTarget}
              selectCommit={selectCommit}
              openDiff={openDiff}
            />
          </div>
        )}
      </div>
    </div>
  );
}
