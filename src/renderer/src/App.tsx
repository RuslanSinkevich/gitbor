import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from './hooks/useAppState';
import { useDiffState } from './hooks/useDiffState';
import { CommitGraph, CommitDetails } from './features/graph';
import { LocalChanges, CommitBar } from './features/changes';
import { DiffPanel } from './features/diff';
import { FileHistory } from './features/file-history';
import { BlameView } from './features/blame';
import { MergeDialog, ConflictNotifyDialog, MergeBanner, MergeEditor } from './features/merge';
import { RebaseEditor } from './features/rebase';
import { Toolbar } from './features/toolbar';
import { Sidebar, BranchStatus } from './features/sidebar';
import { RepoTabs } from './features/repo-tabs';
import { RepoManager, addRecentRepo } from './features/repo-manager';
import { SgContextMenu, type SgContextMenuItem } from './ui/SgContextMenu';
import { SgSplitPane } from './ui/SgSplitPane';
import { SgToastContainer, type SgToastData } from './ui/SgToast';
import { usePromptDialog, SgPromptDialog } from './ui/SgPromptDialog';
import { postCommand } from './api';
import { t, setLang, getLang } from './i18n';
import { UiShowcase } from './pages/UiShowcase';
import { SgButton } from './ui';
import s from './App.module.css';

type Page = 'app' | 'ui-kit';
type Theme = 'dark' | 'light';
type ViewMode = 'changes' | 'commits';
type RightPanel = 'diff' | 'history' | 'blame';

const isDev = import.meta.env.DEV;

function getInitialTheme(): Theme {
  return (localStorage.getItem('sg-theme') as Theme) || 'light';
}

export function App() {
  const {
    state, commitDetail, mergeState, error, selectCommit, clearError,
    viewOverride, clearViewOverride,
    rebaseProgress,
    recoveryIssues, clearRecoveryIssues,
    pendingOpenDiff, clearPendingOpenDiff,
    pendingOpenMergeEditor, clearPendingOpenMergeEditor,
    pendingMenuAction, clearPendingMenuAction,
  } = useAppState();
  const [viewMode, setViewMode] = useState<ViewMode>('changes');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: SgContextMenuItem[] } | null>(null);
  const [toasts, setToasts] = useState<SgToastData[]>([]);
  const { prompt, showPrompt, closePrompt } = usePromptDialog();
  const { diffTarget, openDiff, closeDiff } = useDiffState();
  const [rightPanel, setRightPanel] = useState<RightPanel>('diff');
  const [mergeDialogSource, setMergeDialogSource] = useState<string | null>(null);
  const [showConflictNotify, setShowConflictNotify] = useState(false);
  const [mergeEditorFile, setMergeEditorFile] = useState<string | null>(null);
  const [rebaseOnto, setRebaseOnto] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('app');
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [lang, setLangState] = useState(getLang);
  const loc = t();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sg-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (state.repoPath && state.repoName) {
      addRecentRepo(state.repoName, state.repoPath);
    }
  }, [state.repoPath, state.repoName]);

  useEffect(() => {
    if (!error) return;
    const id = Date.now().toString();
    setToasts(prev => {
      if (prev.some(t => t.message === error)) return prev;
      return [...prev, { id, message: error, type: 'error' as const }];
    });
    clearError();
  }, [error, clearError]);

  useEffect(() => {
    if (viewOverride) {
      setViewMode(viewOverride);
      clearViewOverride();
    }
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
      setMergeEditorFile(pendingOpenMergeEditor.file);
      setViewMode('changes');
      clearPendingOpenMergeEditor();
    }
  }, [pendingOpenMergeEditor, clearPendingOpenMergeEditor]);

  const prevMergeRef = useRef(false);
  useEffect(() => {
    if (mergeState?.inProgress && !prevMergeRef.current) {
      const hasConflicts = mergeState.conflictFiles.some(f => f.status === 'conflicted');
      if (hasConflicts) {
        setShowConflictNotify(true);
        setViewMode('changes');
      }
    }
    prevMergeRef.current = !!mergeState?.inProgress;
  }, [mergeState]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const toggleLang = useCallback(() => {
    const next = lang === 'en' ? 'ru' : 'en';
    setLang(next);
    setLangState(next);
  }, [lang]);

  const handleContextMenu = (e: React.MouseEvent, items: SgContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const handleOpenMergeDialog = useCallback((source: string) => {
    setMergeDialogSource(source);
  }, []);

  useEffect(() => {
    if (pendingMenuAction) {
      const { action } = pendingMenuAction;
      clearPendingMenuAction();
      if (action === 'newBranch') {
        showPrompt({
          title: loc.menu.newBranch,
          placeholder: 'branch-name',
          onConfirm: (name) => postCommand({ type: 'createBranch', name, from: state.currentBranch }),
        });
      } else if (action === 'merge') {
        if (state.branches.length > 0) {
          handleOpenMergeDialog(state.branches.find(b => !b.isCurrent)?.name || '');
        }
      } else if (action === 'about') {
        setToasts(prev => [...prev, { id: Date.now().toString(), message: `SkyFork v0.1 — Git Client`, type: 'info' as const }]);
      }
    }
  }, [pendingMenuAction, clearPendingMenuAction, showPrompt, state.currentBranch, state.branches, handleOpenMergeDialog, loc]);

  const handleOpenMergeEditor = useCallback((file: string) => {
    setMergeEditorFile(file);
  }, []);

  const handleSelectRef = useCallback((hash: string) => {
    setViewMode('commits');
    setRightPanel('diff');
    closeDiff();
    selectCommit(hash);
  }, [selectCommit, closeDiff]);

  const openFileHistory = useCallback((file: string) => {
    openDiff(file, diffTarget?.hash || 'WORKING');
    setRightPanel('history');
  }, [openDiff, diffTarget]);

  const openFileBlame = useCallback((file: string, hash?: string) => {
    openDiff(file, hash || 'WORKING');
    setRightPanel('blame');
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
      <header className={s.titlebar}>
        <span className={s.titlebarTitle}>{loc.app.title}</span>
        <div className={s.titlebarNav}>
          {isDev && (
            <>
              <SgButton variant={page === 'app' ? 'primary' : 'ghost'} size="sm" onClick={() => setPage('app')}>App</SgButton>
              <SgButton variant={page === 'ui-kit' ? 'primary' : 'ghost'} size="sm" onClick={() => setPage('ui-kit')}>{loc.showcase.title}</SgButton>
            </>
          )}
          <button className={s.langToggle} onClick={toggleLang} title={lang === 'en' ? 'Русский' : 'English'}>
            {lang === 'en' ? 'RU' : 'EN'}
          </button>
          <button className={s.themeToggle} onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {page === 'ui-kit' && <UiShowcase />}

      {page === 'app' && (
        <>
          <RepoTabs repos={state.openRepos} activeIndex={state.activeRepoIndex} hasChanges={stagedCount + unstagedCount > 0} />

          {hasRepo && (
            <Toolbar isOperationRunning={state.isOperationRunning} hasUpstream={state.branches.some(b => b.isCurrent && b.upstream)} />
          )}

          {mergeState?.inProgress && <MergeBanner mergeState={mergeState} />}

          <main className={s.main}>
            {hasRepo && (
              <SgSplitPane
                defaultSize={240}
                left={
                  <aside className={s.sidebar}>
                    <Sidebar
                      currentBranch={state.currentBranch}
                      branches={state.branches}
                      remotes={state.remotes}
                      tags={state.tags}
                      stashes={state.stashes}
                      ahead={state.ahead}
                      behind={state.behind}
                      stagedCount={stagedCount}
                      unstagedCount={unstagedCount}
                      activeView={viewMode}
                      onContextMenu={handleContextMenu}
                      onSwitchView={setViewMode}
                      onSelectRef={handleSelectRef}
                      onMerge={handleOpenMergeDialog}
                      showPrompt={showPrompt}
                    />
                  </aside>
                }
                right={
                  <section className={s.content}>
                    {viewMode === 'commits' ? (
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
                            onContextMenu={handleContextMenu}
                            showPrompt={showPrompt}
                            onRebase={setRebaseOnto}
                            onLoadMore={() => postCommand({ type: 'getGraphData', maxCount: state.commits.length + 2000 })}
                          />
                        </div>
                        <div className={s.commitBottomPane}>
                          <div className={s.detailPane}>
                            <CommitDetails detail={commitDetail} onSelectCommit={selectCommit} onOpenDiff={openDiff} onContextMenu={handleContextMenu} onFileHistory={openFileHistory} onFileBlame={(f) => openFileBlame(f)} activePath={diffTarget?.file} />
                          </div>
                          {diffTarget && (
                            <div className={s.commitDiffPane}>
                              {rightPanel === 'history' ? (
                                <FileHistory file={diffTarget.file} onOpenDiff={(f, h) => { openDiff(f, h); setRightPanel('diff'); }} />
                              ) : rightPanel === 'blame' ? (
                                <BlameView file={diffTarget.file} hash={diffTarget.hash} onSelectCommit={selectCommit} />
                              ) : (
                                <DiffPanel file={diffTarget.file} hash={diffTarget.hash} />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className={s.changesLayout}>
                        <div className={s.changesFileList}>
                          <LocalChanges
                            unstagedFiles={state.unstagedFiles}
                            stagedFiles={state.stagedFiles}
                            mergeInProgress={mergeState?.inProgress}
                            onContextMenu={handleContextMenu}
                            onOpenDiff={(f, h) => { openDiff(f, h); setMergeEditorFile(null); setRightPanel('diff'); }}
                            onFileHistory={openFileHistory}
                            onFileBlame={(f) => openFileBlame(f)}
                            onOpenMergeEditor={handleOpenMergeEditor}
                            activePath={mergeEditorFile || diffTarget?.file}
                          />
                          <CommitBar stagedCount={stagedCount} isOperationRunning={state.isOperationRunning} />
                        </div>
                        <div className={s.changesDiff}>
                          {mergeEditorFile ? (
                            <MergeEditor
                              file={mergeEditorFile}
                              sourceBranch={mergeState?.sourceBranch || ''}
                              targetBranch={mergeState?.targetBranch || ''}
                              onResolved={() => { setMergeEditorFile(null); postCommand({ type: 'getMergeState' }); }}
                              onCancel={() => setMergeEditorFile(null)}
                            />
                          ) : diffTarget
                            ? rightPanel === 'history'
                              ? <FileHistory file={diffTarget.file} onOpenDiff={(f, h) => { openDiff(f, h); setRightPanel('diff'); }} />
                              : rightPanel === 'blame'
                                ? <BlameView file={diffTarget.file} hash={diffTarget.hash} onSelectCommit={selectCommit} />
                                : <DiffPanel file={diffTarget.file} hash={diffTarget.hash} />
                            : <div className={s.emptyDiff}>{loc.details.selectCommit}</div>
                          }
                        </div>
                      </div>
                    )}
                  </section>
                }
              />
            )}

            {!hasRepo && (
              <RepoManager state={state} />
            )}
          </main>

          <footer className={s.statusbar}>
            {hasRepo ? (
              <BranchStatus
                currentBranch={state.currentBranch}
                ahead={state.ahead}
                behind={state.behind}
                stagedCount={stagedCount}
                unstagedCount={unstagedCount}
                isOperationRunning={state.isOperationRunning}
                currentOperation={state.currentOperation}
              />
            ) : (
              <span>{loc.statusbar.noRepo}</span>
            )}
          </footer>
        </>
      )}

      {contextMenu && (
        <SgContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />
      )}

      {rebaseOnto && (
        <div className={s.overlay}>
          <div className={s.overlayContent}>
            <RebaseEditor onto={rebaseOnto} onClose={() => setRebaseOnto(null)} />
          </div>
        </div>
      )}

      {mergeDialogSource && (
        <MergeDialog
          source={mergeDialogSource}
          target={state.currentBranch}
          onClose={() => setMergeDialogSource(null)}
        />
      )}

      {showConflictNotify && mergeState && (
        <ConflictNotifyDialog
          mergeState={mergeState}
          onClose={() => setShowConflictNotify(false)}
          onOpenMergeEditor={handleOpenMergeEditor}
        />
      )}

      <SgPromptDialog prompt={prompt} onClose={closePrompt} />
      <SgToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  );
}
