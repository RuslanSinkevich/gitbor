import { CommitGraph, CommitDetails } from '../graph';
import { RightPanelContent, type RightPanel } from './RightPanelContent';
import { SgSplitPane } from '../../ui/SgSplitPane';
import { postCommand } from '../../api';
import { buildStorageKey } from '../../shared/uiPersist';
import type { AppState, CommitDetail } from '../../types';
import type { ShowContextMenuFn } from '../../hooks/useContextMenu';
import type { ShowPromptFn } from '../../ui/SgPromptDialog';
import type { RequestCheckout } from '../checkout';
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
  showContextMenu: ShowContextMenuFn;
  showPrompt: ShowPromptFn;
  requestCheckout: RequestCheckout;
  setRebaseOnto: (onto: string | null) => void;
  compareFrom?: string | null;
  onCompareFrom?: (hash: string) => void;
  onCompareTo?: (from: string, to: string) => void;
}

export function CommitsView({
  state, commitDetail, diffTarget, rightPanel, setRightPanel,
  selectCommit, openDiff, openFileHistory, openFileBlame,
  showContextMenu, showPrompt, requestCheckout, setRebaseOnto,
  compareFrom, onCompareFrom, onCompareTo,
}: Props) {
  const graphHeightKey = buildStorageKey('sg-layout:commits-graph-height', state.repoPath);
  const detailWidthKey = buildStorageKey('sg-layout:commits-detail-width', state.repoPath);

  const graphPane = (
    <div className={s.graphPane}>
      <CommitGraph
        commits={state.commits}
        graphNodes={state.graphLayout.nodes}
        maxColumns={state.graphLayout.maxColumns}
        mergeLinks={state.graphLayout.mergeLinks ?? []}
        selectedHash={state.selectedCommitHash}
        onSelect={selectCommit}
        currentBranch={state.currentBranch}
        repoPath={state.repoPath}
        onContextMenu={showContextMenu}
        showPrompt={showPrompt}
        requestCheckout={requestCheckout}
        onRebase={setRebaseOnto}
        onLoadMore={() => postCommand({ type: 'getGraphData', maxCount: state.commits.length + 50000 })}
        compareFrom={compareFrom}
        onCompareFrom={onCompareFrom}
        onCompareTo={onCompareTo}
      />
    </div>
  );

  const detailPane = (
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
  );

  const bottomPane = (
    <div className={s.commitBottomPane}>
      {diffTarget ? (
        <SgSplitPane
          direction="horizontal"
          defaultSize={360}
          minSize={220}
          maxSize={720}
          minOpposite={240}
          storageKey={detailWidthKey}
          left={detailPane}
          right={
            <div className={s.commitDiffPane}>
              <RightPanelContent
                rightPanel={rightPanel}
                setRightPanel={setRightPanel}
                diffTarget={diffTarget}
                selectCommit={selectCommit}
                openDiff={openDiff}
              />
            </div>
          }
        />
      ) : (
        detailPane
      )}
    </div>
  );

  return (
    <div className={s.commitsLayout}>
      <SgSplitPane
        direction="vertical"
        defaultSize={420}
        minSize={160}
        maxSize={2000}
        minOpposite={160}
        storageKey={graphHeightKey}
        left={graphPane}
        right={bottomPane}
      />
    </div>
  );
}
