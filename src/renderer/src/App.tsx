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
import { useAutoFetch } from './hooks/useAutoFetch';
import { useSyncActions } from './hooks/useSyncActions';
import { TitleBar } from './features/titlebar';
import { CommitsView, ChangesView, type RightPanel } from './features/layout';
import { MergeBanner } from './features/merge';
import { Toolbar } from './features/toolbar';
import { Sidebar, BranchStatus } from './features/sidebar';
import { RepoTabs } from './features/repo-tabs';
import { RepoManager, addRecentRepo, loadLastActiveRepo, saveLastActiveRepo, clearLastActiveRepo, removeRecentRepo } from './features/repo-manager';
import { SgSplitPane } from './ui/SgSplitPane';
import { usePromptDialog } from './ui/SgPromptDialog';
import { AppDialogs } from './AppDialogs';
import { postCommand, onMainEvent, invokeCommand } from './api';
import { t, tpl, setLang, getLang } from './i18n';
import { UiShowcase } from './pages/UiShowcase';
import { buildStorageKey } from './shared/uiPersist';
import s from './App.module.css';

type Page = 'app' | 'ui-kit';
type ViewMode = 'changes' | 'commits';

export function App() {
  const {
    state, commitDetail, mergeState, error, selectCommit: rawSelectCommit, clearError,
    viewOverride, clearViewOverride,
    rebaseProgress,
    pendingOpenDiff, clearPendingOpenDiff,
    pendingOpenMergeEditor, clearPendingOpenMergeEditor,
    lastOpResult, clearLastOpResult,
    switchRepoFast,
  } = useAppState();

  const { theme, toggleTheme } = useTheme();
  const { toasts, addToast, dismissToast } = useToasts(error, clearError);
  const { contextMenu, showContextMenu, closeContextMenu } = useContextMenu();
  const { prompt, showPrompt, closePrompt } = usePromptDialog();
  const { diffTarget, openDiff, closeDiff } = useDiffState();

  /**
   * Унифицированный selectCommit: когда снимаем выбор (`null`) — заодно
   * закрываем diff, иначе справа остаётся открытый DiffPanel со старыми
   * file/hash от прошлого выбранного коммита («Выберите коммит для
   * просмотра деталей» в основной зоне vs. живой diff в правой панели).
   */
  const selectCommit = useCallback((hash: string | null) => {
    if (hash === null) closeDiff();
    rawSelectCommit(hash);
  }, [rawSelectCommit, closeDiff]);

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
  const { runPull, runPush, syncDialogs } = useSyncActions(state, loc);

  useOperationToasts(lastOpResult, clearLastOpResult, addToast);
  useAutoFetch(state.repoPath, !!state.repoPath, (msg) => addToast(msg, 'info'));

  const handleOpenMergeDialog = useCallback((source: string) => {
    setMergeDialogSource(source);
  }, []);

  const handleMenuAction = useMenuActions({
    state, setViewMode, ...dlg, showPrompt, handleOpenMergeDialog, runPull, runPush,
  });

  useKeyboardShortcuts(handleMenuAction);

  const restoreLastRepoAttempted = useRef(false);

  // Восстанавливаем last active repo ТОЛЬКО если main ничего не подцепил
  // авто. Иначе мы убивали текущее открытие (например, dev cwd=skyfork) и
  // насильно загружали тяжёлый last (бывало `C:\Users\Admin` с 440k файлов).
  useEffect(() => {
    if (restoreLastRepoAttempted.current) return;
    const last = loadLastActiveRepo();
    if (!last) {
      restoreLastRepoAttempted.current = true;
      return;
    }
    if (!state.repoPath) {
      restoreLastRepoAttempted.current = true;
      // invokeCommand → можно поймать reject от main (path удалён, нет .git
      // и т.п.) и почистить last/recents, чтобы не зацикливаться при старте.
      void invokeCommand({ type: 'openRepo', path: last }).catch(() => {
        clearLastActiveRepo();
        removeRecentRepo(last);
      });
    } else {
      // Уже что-то открыто (auto cwd / явный openRepo): не подменяем.
      restoreLastRepoAttempted.current = true;
    }
  }, [state.repoPath]);

  useEffect(() => {
    if (state.repoPath && state.repoName) {
      saveLastActiveRepo(state.repoPath);
      addRecentRepo(state.repoName, state.repoPath);
    }
  }, [state.repoPath, state.repoName]);

  /**
   * Унифицированный reset локального UI-state'а при смене активного репо.
   * `useAppState` чистит свой global state на `switchRepoFast`/`repoClosed`,
   * но локальные state-ы App.tsx (открытый файл diff, конфликт-файл, форма
   * compare/rebase, активная панель) живут отдельно — без сброса оставались
   * пути из закрытого/прошлого репо. Срабатывает только на _смену_ repoPath,
   * не на первое его появление.
   */
  const prevRepoPathRef = useRef<string>(state.repoPath);
  const prevCommitHashRef = useRef<string | null>(null);
  const prevMergeRef = useRef(false);
  useEffect(() => {
    const prev = prevRepoPathRef.current;
    if (prev === state.repoPath) return;
    prevRepoPathRef.current = state.repoPath;
    // Первое появление пути (prev был пуст) — это начальная загрузка, нечего сбрасывать.
    if (!prev) return;
    closeDiff();
    setRightPanel('diff');
    setConflictFile(null);
    setMergeEditorFile(null);
    setRebaseOnto(null);
    setCompareFromHash(null);
    setMergeDialogSource(null);
    prevCommitHashRef.current = null;
    prevMergeRef.current = false;
  }, [state.repoPath, closeDiff]);

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
    const inUnstaged = state.unstagedFiles.some(f => f.path === file);
    const inStaged = state.stagedFiles.some(f => f.path === file);
    if (!inUnstaged && !inStaged) {
      closeDiff();
      return;
    }
    // Файл переехал между секциями (stage/unstage): старый diff-контекст невалиден, очищаем правую панель.
    if ((hash === 'WORKING' && !inUnstaged) || (hash === 'STAGED' && !inStaged)) {
      closeDiff();
    }
  }, [state.unstagedFiles, state.stagedFiles, diffTarget, viewMode, closeDiff]);

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
          <RepoTabs repos={state.openRepos} activeIndex={state.activeRepoIndex} hasChanges={stagedCount + unstagedCount > 0} onSwitch={switchRepoFast} />

          {hasRepo && (
            <Toolbar
              isOperationRunning={state.isOperationRunning}
              hasUpstream={state.branches.some(b => b.isCurrent && b.upstream)}
              onPull={runPull}
              onPush={runPush}
              onOpenActivity={() => dlg.setShowGitActivity(true)}
              repoPath={state.repoPath}
            />
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
              // key={state.repoPath} — финальная страховка для всех локальных
              // state-ов внутри Sidebar/CommitsView/ChangesView/DiffPanel/
              // BlameView/FileHistory/CommitDetails: при смене репо subtree
              // полностью пересоздаётся, никаких остатков от прошлого контекста.
              <SgSplitPane
                key={state.repoPath}
                defaultSize={240}
                minOpposite={360}
                storageKey={buildStorageKey('sg-layout:sidebar-width')}
                left={
                  <aside className={s.sidebar}>
                    <Sidebar
                      repoPath={state.repoPath}
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
                        showContextMenu={showContextMenu} openDiff={openDiff} closeDiff={closeDiff}
                        openFileHistory={openFileHistory} openFileBlame={openFileBlame}
                        handleOpenMergeEditor={handleOpenMergeEditor}
                        handleConflictResolved={handleConflictResolved}
                        selectCommit={selectCommit} showPrompt={showPrompt} loc={loc}
                        onOpenAiSettings={() => dlg.setShowAiSettings(true)}
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
                onPull={() => runPull(false)}
                onPush={() => runPush(false)}
              />
            ) : (
              <span>{loc.statusbar.noRepo}</span>
            )}
          </footer>
        </>
      )}

      <AppDialogs
        contextMenu={contextMenu} closeContextMenu={closeContextMenu}
        rebaseOnto={rebaseOnto} setRebaseOnto={setRebaseOnto}
        mergeEditorFile={mergeEditorFile} setMergeEditorFile={setMergeEditorFile}
        mergeState={mergeState} handleConflictResolved={handleConflictResolved}
        mergeDialogSource={mergeDialogSource} setMergeDialogSource={setMergeDialogSource}
        currentBranch={state.currentBranch}
        prompt={prompt} closePrompt={closePrompt}
        toasts={toasts} dismissToast={dismissToast}
        dlg={dlg} showPrompt={showPrompt} loc={loc}
        repoPath={state.repoPath}
      />

      {syncDialogs}
    </div>
  );
}
