import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from './hooks/useAppState';
import { useDiffState } from './hooks/useDiffState';
import { useTheme } from './hooks/useTheme';
import { useToasts } from './hooks/useToasts';
import { useContextMenu } from './hooks/useContextMenu';
import { useMenuActions } from './hooks/useMenuActions';
import { useOperationToasts } from './hooks/useOperationToasts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useDialogs } from './hooks/useDialogs';
import { TitleBar } from './features/titlebar';
import { CommitsView, ChangesView, type RightPanel } from './features/layout';
import { MergeDialog, MergeBanner, MergeEditor } from './features/merge';
import { RebaseEditor } from './features/rebase';
import { Toolbar } from './features/toolbar';
import { Sidebar, BranchStatus } from './features/sidebar';
import { RepoTabs } from './features/repo-tabs';
import { RepoManager, addRecentRepo } from './features/repo-manager';
import { SgContextMenu } from './ui/SgContextMenu';
import { SgSplitPane } from './ui/SgSplitPane';
import { SgToastContainer } from './ui/SgToast';
import { usePromptDialog, SgPromptDialog } from './ui/SgPromptDialog';
import { AboutDialog } from './ui/AboutDialog';
import { SshKeysDialog } from './features/ssh';
import { RepoSettingsDialog } from './features/settings';
import { ReflogDialog } from './features/reflog';
import { BisectDialog } from './features/bisect';
import { HooksDialog } from './features/hooks';
import { WorktreesDialog } from './features/worktrees';
import { LfsDialog } from './features/lfs';
import { GitignoreDialog } from './features/gitignore';
import { postCommand, onMainEvent } from './api';
import { t, tpl, setLang, getLang } from './i18n';
import { UiShowcase } from './pages/UiShowcase';
import s from './App.module.css';

type Page = 'app' | 'ui-kit';
type ViewMode = 'changes' | 'commits';

export function App() {
  const {
    state, commitDetail, mergeState, error, selectCommit, clearError,
    viewOverride, clearViewOverride,
    rebaseProgress,
    pendingOpenDiff, clearPendingOpenDiff,
    pendingOpenMergeEditor, clearPendingOpenMergeEditor,
    lastOpResult, clearLastOpResult,
  } = useAppState();

  const { theme, toggleTheme } = useTheme();
  const { toasts, addToast, dismissToast } = useToasts(error, clearError);
  const { contextMenu, showContextMenu, closeContextMenu } = useContextMenu();
  const { prompt, showPrompt, closePrompt } = usePromptDialog();
  const { diffTarget, openDiff, closeDiff } = useDiffState();

  const [viewMode, setViewMode] = useState<ViewMode>('changes');
  const [rightPanel, setRightPanel] = useState<RightPanel>('diff');
  const [mergeDialogSource, setMergeDialogSource] = useState<string | null>(null);
  const [conflictFile, setConflictFile] = useState<string | null>(null);
  const [mergeEditorFile, setMergeEditorFile] = useState<string | null>(null);
  const [rebaseOnto, setRebaseOnto] = useState<string | null>(null);
  const [compareFromHash, setCompareFromHash] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('app');
  const [lang, setLangState] = useState(getLang);
  const dlg = useDialogs();
  const loc = t();

  useOperationToasts(lastOpResult, clearLastOpResult, addToast);

  const handleOpenMergeDialog = useCallback((source: string) => {
    setMergeDialogSource(source);
  }, []);

  const handleMenuAction = useMenuActions({
    state, setViewMode, ...dlg, showPrompt, handleOpenMergeDialog,
  });

  useKeyboardShortcuts(handleMenuAction);

  useEffect(() => {
    if (state.repoPath && state.repoName) addRecentRepo(state.repoName, state.repoPath);
  }, [state.repoPath, state.repoName]);

  useEffect(() => {
    if (viewOverride) { setViewMode(viewOverride); clearViewOverride(); }
  }, [viewOverride, clearViewOverride]);

  useEffect(() => {
    if (pendingOpenDiff) {
      openDiff(pendingOpenDiff.file, pendingOpenDiff.hash);
      setRightPanel('diff');
      clearPendingOpenDiff();
    }
  }, [pendingOpenDiff, openDiff, clearPendingOpenDiff]);

  useEffect(() => {
    if (pendingOpenMergeEditor) {
      setConflictFile(pendingOpenMergeEditor.file);
      setMergeEditorFile(null);
      setViewMode('changes');
      clearPendingOpenMergeEditor();
    }
  }, [pendingOpenMergeEditor, clearPendingOpenMergeEditor]);

  useEffect(() => {
    if (!diffTarget || viewMode !== 'changes') return;
    const { file, hash } = diffTarget;
    if (hash !== 'WORKING' && hash !== 'STAGED') return;
    if (![...state.unstagedFiles, ...state.stagedFiles].some(f => f.path === file)) closeDiff();
  }, [state.unstagedFiles, state.stagedFiles, diffTarget, viewMode, closeDiff]);

  const prevMergeRef = useRef(false);
  useEffect(() => {
    const wasInProgress = prevMergeRef.current;
    const isNow = !!mergeState?.inProgress;
    if (isNow && !wasInProgress) {
      const first = mergeState!.conflictFiles.find(f => f.status === 'conflicted');
      if (first) { setViewMode('changes'); setConflictFile(first.path); }
    }
    if (!isNow && wasInProgress) { setConflictFile(null); setMergeEditorFile(null); closeDiff(); }
    prevMergeRef.current = isNow;
  }, [mergeState, closeDiff]);

  const toggleLang = useCallback(() => {
    const next = lang === 'en' ? 'ru' : 'en';
    setLang(next);
    setLangState(next);
  }, [lang]);

  const handleOpenMergeEditor = useCallback((file: string) => {
    setConflictFile(file);
    setMergeEditorFile(null);
  }, []);

  const handleConflictResolved = useCallback((resolvedPath: string) => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'mergeState') {
        unsub();
        const next = msg.data.conflictFiles.find(f => f.status === 'conflicted' && f.path !== resolvedPath);
        setConflictFile(next ? next.path : null);
      }
    });
    postCommand({ type: 'getMergeState' });
  }, []);

  const handleSelectRef = useCallback((hash: string) => {
    setViewMode('commits'); setRightPanel('diff'); closeDiff(); selectCommit(hash);
  }, [selectCommit, closeDiff]);

  const handleCompareTo = useCallback((fromHash: string, toHash: string) => {
    postCommand({ type: 'getCommitDiff', fromHash, toHash });
    setCompareFromHash(null);
  }, []);

  const openFileHistory = useCallback((file: string) => {
    openDiff(file, diffTarget?.hash || 'WORKING'); setRightPanel('history');
  }, [openDiff, diffTarget]);

  const openFileBlame = useCallback((file: string, hash?: string) => {
    openDiff(file, hash || 'WORKING'); setRightPanel('blame');
  }, [openDiff]);

  const prevCommitHashRef = useRef<string | null>(null);
  useEffect(() => {
    const newHash = commitDetail?.hash ?? null;
    if (newHash && newHash !== prevCommitHashRef.current) {
      prevCommitHashRef.current = newHash;
      if (viewMode === 'commits' && commitDetail!.files.length > 0) {
        openDiff(commitDetail!.files[0].path, commitDetail!.hash);
      }
    }
  }, [commitDetail, viewMode, openDiff]);

  const hasRepo = !!state.repoPath;
  const stagedCount = state.stagedFiles.length;
  const unstagedCount = state.unstagedFiles.length;

  return (
    <div className={s.app}>
      <TitleBar
        loc={loc} page={page} setPage={setPage}
        lang={lang} toggleLang={toggleLang}
        theme={theme} toggleTheme={toggleTheme}
        onMenuAction={handleMenuAction}
        onOpenRepo={() => postCommand({ type: 'openRepoDialog' })}
      />

      {page === 'ui-kit' && <UiShowcase />}

      {page === 'app' && (
        <>
          <RepoTabs repos={state.openRepos} activeIndex={state.activeRepoIndex} hasChanges={stagedCount + unstagedCount > 0} />

          {hasRepo && (
            <Toolbar isOperationRunning={state.isOperationRunning} hasUpstream={state.branches.some(b => b.isCurrent && b.upstream)} />
          )}

          {mergeState?.inProgress && <MergeBanner mergeState={mergeState} showPrompt={showPrompt} />}

          {rebaseProgress?.inProgress && (
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
            {hasRepo ? (
              <SgSplitPane
                defaultSize={240}
                left={
                  <aside className={s.sidebar}>
                    <Sidebar
                      currentBranch={state.currentBranch} branches={state.branches}
                      remotes={state.remotes} tags={state.tags} stashes={state.stashes}
                      ahead={state.ahead} behind={state.behind}
                      stagedCount={stagedCount} unstagedCount={unstagedCount}
                      activeView={viewMode}
                      onContextMenu={showContextMenu} onSwitchView={setViewMode}
                      onSelectRef={handleSelectRef} onMerge={handleOpenMergeDialog}
                      showPrompt={showPrompt}
                    />
                  </aside>
                }
                right={
                  <section className={s.content}>
                    {viewMode === 'commits' ? (
                      <CommitsView
                        state={state} commitDetail={commitDetail} diffTarget={diffTarget}
                        rightPanel={rightPanel} setRightPanel={setRightPanel}
                        selectCommit={selectCommit} openDiff={openDiff}
                        openFileHistory={openFileHistory} openFileBlame={openFileBlame}
                        showContextMenu={showContextMenu} showPrompt={showPrompt}
                        setRebaseOnto={setRebaseOnto}
                        compareFrom={compareFromHash}
                        onCompareFrom={setCompareFromHash}
                        onCompareTo={handleCompareTo}
                      />
                    ) : (
                      <ChangesView
                        state={state} mergeState={mergeState} diffTarget={diffTarget}
                        rightPanel={rightPanel} setRightPanel={setRightPanel}
                        conflictFile={conflictFile} setConflictFile={setConflictFile}
                        setMergeEditorFile={setMergeEditorFile}
                        showContextMenu={showContextMenu} openDiff={openDiff}
                        openFileHistory={openFileHistory} openFileBlame={openFileBlame}
                        handleOpenMergeEditor={handleOpenMergeEditor}
                        handleConflictResolved={handleConflictResolved}
                        selectCommit={selectCommit} showPrompt={showPrompt} loc={loc}
                      />
                    )}
                  </section>
                }
              />
            ) : (
              <RepoManager state={state} />
            )}
          </main>

          <footer className={s.statusbar}>
            {hasRepo ? (
              <BranchStatus
                currentBranch={state.currentBranch} ahead={state.ahead} behind={state.behind}
                stagedCount={stagedCount} unstagedCount={unstagedCount}
                isOperationRunning={state.isOperationRunning} currentOperation={state.currentOperation}
              />
            ) : (
              <span>{loc.statusbar.noRepo}</span>
            )}
          </footer>
        </>
      )}

      {contextMenu && <SgContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={closeContextMenu} />}

      {rebaseOnto && (
        <div className={s.overlay}>
          <div className={s.overlayContent}>
            <RebaseEditor onto={rebaseOnto} onClose={() => setRebaseOnto(null)} />
          </div>
        </div>
      )}

      {mergeEditorFile && (
        <MergeEditor
          file={mergeEditorFile}
          sourceBranch={mergeState?.sourceBranch || ''} targetBranch={mergeState?.targetBranch || ''}
          onResolved={() => { setMergeEditorFile(null); handleConflictResolved(mergeEditorFile); }}
          onCancel={() => setMergeEditorFile(null)}
        />
      )}

      {mergeDialogSource && (
        <MergeDialog source={mergeDialogSource} target={state.currentBranch} onClose={() => setMergeDialogSource(null)} />
      )}

      <SgPromptDialog prompt={prompt} onClose={closePrompt} />
      <SgToastContainer toasts={toasts} onDismiss={dismissToast} />
      {dlg.showAbout && <AboutDialog onClose={() => dlg.setShowAbout(false)} loc={loc} />}
      {dlg.showSshKeys && <SshKeysDialog onClose={() => dlg.setShowSshKeys(false)} />}
      {dlg.showRepoSettings && <RepoSettingsDialog onClose={() => dlg.setShowRepoSettings(false)} />}
      {dlg.showReflog && <ReflogDialog onClose={() => dlg.setShowReflog(false)} showPrompt={showPrompt} />}
      {dlg.showBisect && <BisectDialog onClose={() => dlg.setShowBisect(false)} />}
      {dlg.showHooks && <HooksDialog onClose={() => dlg.setShowHooks(false)} />}
      {dlg.showWorktrees && <WorktreesDialog onClose={() => dlg.setShowWorktrees(false)} showPrompt={showPrompt} />}
      {dlg.showLfs && <LfsDialog onClose={() => dlg.setShowLfs(false)} />}
      {dlg.showGitignore && <GitignoreDialog onClose={() => dlg.setShowGitignore(false)} />}
    </div>
  );
}
