import type { ComponentProps } from 'react';
import { postCommand } from '../../api';
import { t, tpl } from '../../i18n';
import { buildStorageKey } from '../../shared/uiPersist';
import { SgSplitPane } from '../../ui/SgSplitPane';
import type { ShowPromptFn } from '../../ui/SgPromptDialog';
import type { ShowContextMenuFn } from '../../hooks/useContextMenu';
import type { RequestCheckout } from '../checkout';
import type { RequestApplyStash } from '../stash';
import { RepoManager } from '../repo-manager';
import { RepoTabs } from '../repo-tabs';
import { Sidebar } from '../sidebar';
import { MergeBanner, shouldShowMergeBanner } from '../merge';
import { Toolbar } from '../toolbar';
import { ChangesView, CommitsView } from '../layout';
import type { AppState, CommitDetail, MergeState, RebaseProgress } from '../../types';
import s from '../../App.module.css';

type ViewMode = 'changes' | 'commits';
type BranchPrefsProp = ComponentProps<typeof Sidebar>['branchPrefs'];

interface Props {
  loc: ReturnType<typeof t>;
  isRestoringTabs: boolean;
  state: AppState;
  hasRepo: boolean;
  localChangesCount: number;
  repoManagerVisible: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  commitDetail: CommitDetail | null;
  diffTarget: { file: string; hash: string } | null;
  mergeState: MergeState | null;
  rebaseProgress?: RebaseProgress | null;
  conflictFile: string | null;
  setConflictFile: (file: string | null) => void;
  setMergeEditorFile: (file: string | null) => void;
  setRebaseOnto: (onto: string | null) => void;
  graphFocusNonce: number;
  /** Бамп → вкладка «Изменения» в CommitsView (меню stash). */
  revealChangesNonce?: number;
  soloBranch: string | null;
  hiddenBranches: Set<string>;
  branchPrefs: BranchPrefsProp;
  onClearSolo: () => void;
  onClearAllHidden: () => void;
  onSwitchRepo: (index: number) => void;
  onShowRepoManager: () => void;
  onContextMenu: ShowContextMenuFn;
  onPull: (rebase?: boolean) => void;
  onPush: (force?: boolean) => void;
  onStash: () => void;
  onOpenActivity: () => void;
  onSelectCommit: (hash: string | null) => void;
  onSelectRef: (hash: string) => void;
  onShowStashChanges?: (hash: string) => void;
  onMerge: (source: string) => void;
  showPrompt: ShowPromptFn;
  requestCheckout: RequestCheckout;
  requestApplyStash: RequestApplyStash;
  openDiff: (file: string, hash: string) => void;
  closeDiff: () => void;
  onOpenMergeEditor: (file: string) => void;
  onConflictResolved: (resolvedPath: string) => void;
  onCompareTo: (fromHash: string, toHash: string) => void;
  onOpenAiSettings: () => void;
  onOpenGitignoreDialog: () => void;
  onExpandDiff: (file: string, hash: string) => void;
}

export function AppWorkspace({
  loc,
  isRestoringTabs,
  state,
  hasRepo,
  localChangesCount,
  repoManagerVisible,
  viewMode,
  setViewMode,
  commitDetail,
  diffTarget,
  mergeState,
  rebaseProgress,
  conflictFile,
  setConflictFile,
  setMergeEditorFile,
  setRebaseOnto,
  graphFocusNonce,
  revealChangesNonce = 0,
  soloBranch,
  hiddenBranches,
  branchPrefs,
  onClearSolo,
  onClearAllHidden,
  onSwitchRepo,
  onShowRepoManager,
  onContextMenu,
  onPull,
  onPush,
  onStash,
  onOpenActivity,
  onSelectCommit,
  onSelectRef,
  onShowStashChanges,
  onMerge,
  showPrompt,
  requestCheckout,
  requestApplyStash,
  openDiff,
  closeDiff,
  onOpenMergeEditor,
  onConflictResolved,
  onCompareTo,
  onOpenAiSettings,
  onOpenGitignoreDialog,
  onExpandDiff,
}: Props) {
  if (isRestoringTabs) {
    return <div className={s.lazyFallback}>{loc.app.loading}</div>;
  }

  return (
    <>
      <RepoTabs
        repos={state.openRepos}
        activeIndex={state.activeRepoIndex}
        hasChanges={localChangesCount > 0}
        onSwitch={onSwitchRepo}
        managerActive={repoManagerVisible}
        onShowManager={onShowRepoManager}
        onContextMenu={onContextMenu}
      />

      {hasRepo && !repoManagerVisible && (
        <Toolbar
          isOperationRunning={state.isOperationRunning}
          hasUpstream={state.branches.some(b => b.isCurrent && b.upstream)}
          ahead={state.ahead}
          behind={state.behind}
          onPull={onPull}
          onPush={onPush}
          onStash={onStash}
          onOpenActivity={onOpenActivity}
          repoPath={state.repoPath}
          mergeState={mergeState}
          showPrompt={showPrompt}
        />
      )}

      {!repoManagerVisible && shouldShowMergeBanner(mergeState) && (
        <MergeBanner mergeState={mergeState!} showPrompt={showPrompt} />
      )}

      {!repoManagerVisible && rebaseProgress?.inProgress && (
        <div className={s.rebaseBanner}>
          <span className={s.rebaseBannerIcon}>⟳</span>
          <span className={s.rebaseBannerText}>
            {tpl(loc.rebaseEditor.progress, { current: rebaseProgress.currentStep, total: rebaseProgress.totalSteps })}
          </span>
          <button className={s.rebaseBannerBtn} onClick={() => postCommand({ type: 'continueRebase' })}>
            {loc.rebaseEditor.continue}
          </button>
          <button className={s.rebaseBannerBtn} onClick={() => postCommand({ type: 'skipRebase' })}>
            {loc.rebaseEditor.skip}
          </button>
          <button className={s.rebaseBannerAbort} onClick={() => postCommand({ type: 'abortRebase' })}>
            {loc.rebaseEditor.abort}
          </button>
        </div>
      )}

      <main className={s.main}>
        {repoManagerVisible ? (
          <RepoManager state={state} />
        ) : (
          <SgSplitPane
            key={state.repoPath}
            defaultSize={240}
            minOpposite={360}
            storageKey={buildStorageKey('sg-layout:sidebar-width')}
            left={
              <aside className={s.sidebar}>
                <Sidebar
                  repoPath={state.repoPath}
                  currentBranch={state.currentBranch}
                  branches={state.branches}
                  remotes={state.remotes}
                  tags={state.tags}
                  stashes={state.stashes}
                  ahead={state.ahead}
                  behind={state.behind}
                  localChangesCount={localChangesCount}
                  activeView={viewMode}
                  onContextMenu={onContextMenu}
                  onSwitchView={setViewMode}
                  onSelectRef={onSelectRef}
                  onShowStashChanges={onShowStashChanges}
                  onMerge={onMerge}
                  showPrompt={showPrompt}
                  requestCheckout={requestCheckout}
                  requestApplyStash={requestApplyStash}
                  selectedRefHash={state.selectedCommitHash}
                  branchPrefs={branchPrefs}
                />
              </aside>
            }
            right={
              <section className={s.content}>
                {viewMode === 'commits' ? (
                  <CommitsView
                    state={state}
                    commitDetail={commitDetail}
                    diffTarget={diffTarget}
                    selectCommit={onSelectCommit}
                    openDiff={openDiff}
                    showContextMenu={onContextMenu}
                    showPrompt={showPrompt}
                    requestCheckout={requestCheckout}
                    setRebaseOnto={setRebaseOnto}
                    onCompareTo={onCompareTo}
                    focusNonce={graphFocusNonce}
                    revealChangesNonce={revealChangesNonce}
                    soloBranch={soloBranch}
                    hidden={hiddenBranches}
                    onClearSolo={onClearSolo}
                    onClearAllHidden={onClearAllHidden}
                    onOpenAiSettings={onOpenAiSettings}
                    onExpandDiff={onExpandDiff}
                  />
                ) : (
                  <ChangesView
                    state={state}
                    mergeState={mergeState}
                    diffTarget={diffTarget}
                    conflictFile={conflictFile}
                    setConflictFile={setConflictFile}
                    setMergeEditorFile={setMergeEditorFile}
                    showContextMenu={onContextMenu}
                    openDiff={openDiff}
                    closeDiff={closeDiff}
                    handleOpenMergeEditor={onOpenMergeEditor}
                    handleConflictResolved={onConflictResolved}
                    showPrompt={showPrompt}
                    loc={loc}
                    onOpenAiSettings={onOpenAiSettings}
                    onOpenGitignoreDialog={onOpenGitignoreDialog}
                    onExpandDiff={onExpandDiff}
                  />
                )}
              </section>
            }
          />
        )}
      </main>

    </>
  );
}
