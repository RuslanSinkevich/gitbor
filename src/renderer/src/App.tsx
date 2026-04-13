import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppState } from './hooks/useAppState';
import { useDiffState } from './hooks/useDiffState';
import { useTheme } from './hooks/useTheme';
import { useToasts } from './hooks/useToasts';
import { useContextMenu } from './hooks/useContextMenu';
import { CommitGraph, CommitDetails } from './features/graph';
import { LocalChanges, CommitBar } from './features/changes';
import { DiffPanel } from './features/diff';
import { FileHistory } from './features/file-history';
import { BlameView } from './features/blame';
import { MergeDialog, MergeBanner, MergeEditor, ConflictPanel } from './features/merge';
import { RebaseEditor } from './features/rebase';
import { Toolbar } from './features/toolbar';
import { Sidebar, BranchStatus } from './features/sidebar';
import { RepoTabs } from './features/repo-tabs';
import { RepoManager, addRecentRepo } from './features/repo-manager';
import { SgContextMenu } from './ui/SgContextMenu';
import { SgSplitPane } from './ui/SgSplitPane';
import { SgToastContainer } from './ui/SgToast';
import { usePromptDialog, SgPromptDialog } from './ui/SgPromptDialog';
import { postCommand } from './api';
import { t, setLang, getLang } from './i18n';
import { UiShowcase } from './pages/UiShowcase';
import { SgButton } from './ui';
import s from './App.module.css';

type Page = 'app' | 'ui-kit';
type ViewMode = 'changes' | 'commits';
type RightPanel = 'diff' | 'history' | 'blame';

const isDev = import.meta.env.DEV;

export function App() {
  const {
    state, commitDetail, mergeState, error, selectCommit, clearError,
    viewOverride, clearViewOverride,
    pendingOpenDiff, clearPendingOpenDiff,
    pendingOpenMergeEditor, clearPendingOpenMergeEditor,
    pendingMenuAction, clearPendingMenuAction,
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
  const [page, setPage] = useState<Page>('app');
  const [lang, setLangState] = useState(getLang);
  const loc = t();

  useEffect(() => {
    if (state.repoPath && state.repoName) {
      addRecentRepo(state.repoName, state.repoPath);
    }
  }, [state.repoPath, state.repoName]);

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
    const allFiles = [...state.unstagedFiles, ...state.stagedFiles];
    if (!allFiles.some(f => f.path === file)) {
      closeDiff();
    }
  }, [state.unstagedFiles, state.stagedFiles, diffTarget, viewMode, closeDiff]);

  const prevMergeRef = useRef(false);
  useEffect(() => {
    const wasInProgress = prevMergeRef.current;
    const isNow = !!mergeState?.inProgress;

    if (isNow && !wasInProgress) {
      const firstConflict = mergeState!.conflictFiles.find(f => f.status === 'conflicted');
      if (firstConflict) {
        setViewMode('changes');
        setConflictFile(firstConflict.path);
      }
    }

    if (!isNow && wasInProgress) {
      setConflictFile(null);
      setMergeEditorFile(null);
      closeDiff();
    }

    prevMergeRef.current = isNow;
  }, [mergeState, closeDiff]);

  const toggleLang = useCallback(() => {
    const next = lang === 'en' ? 'ru' : 'en';
    setLang(next);
    setLangState(next);
  }, [lang]);

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
        addToast(`SkyFork v0.1 — Git Client`, 'info');
      }
    }
  }, [pendingMenuAction, clearPendingMenuAction, showPrompt, state.currentBranch, state.branches, handleOpenMergeDialog, loc, addToast]);

  const handleOpenMergeEditor = useCallback((file: string) => {
    setConflictFile(file);
    setMergeEditorFile(null);
  }, []);

  const handleConflictResolved = useCallback((resolvedPath: string) => {
    postCommand({ type: 'getMergeState' });
    const remaining = mergeState?.conflictFiles.filter(
      f => f.status === 'conflicted' && f.path !== resolvedPath,
    );
    if (remaining && remaining.length > 0) {
      setConflictFile(remaining[0].path);
    } else {
      setConflictFile(null);
    }
  }, [mergeState]);

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
      <TitleBar
        loc={loc}
        page={page}
        setPage={setPage}
        lang={lang}
        toggleLang={toggleLang}
        theme={theme}
        toggleTheme={toggleTheme}
      />

      {page === 'ui-kit' && <UiShowcase />}

      {page === 'app' && (
        <>
          <RepoTabs repos={state.openRepos} activeIndex={state.activeRepoIndex} hasChanges={stagedCount + unstagedCount > 0} />

          {hasRepo && (
            <Toolbar isOperationRunning={state.isOperationRunning} hasUpstream={state.branches.some(b => b.isCurrent && b.upstream)} />
          )}

          {mergeState?.inProgress && <MergeBanner mergeState={mergeState} showPrompt={showPrompt} />}

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
                      onContextMenu={showContextMenu}
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
                      <CommitsView
                        state={state}
                        commitDetail={commitDetail}
                        diffTarget={diffTarget}
                        rightPanel={rightPanel}
                        setRightPanel={setRightPanel}
                        selectCommit={selectCommit}
                        openDiff={openDiff}
                        openFileHistory={openFileHistory}
                        openFileBlame={openFileBlame}
                        showContextMenu={showContextMenu}
                        showPrompt={showPrompt}
                        setRebaseOnto={setRebaseOnto}
                      />
                    ) : (
                      <ChangesView
                        state={state}
                        mergeState={mergeState}
                        diffTarget={diffTarget}
                        rightPanel={rightPanel}
                        setRightPanel={setRightPanel}
                        conflictFile={conflictFile}
                        setConflictFile={setConflictFile}
                        setMergeEditorFile={setMergeEditorFile}
                        showContextMenu={showContextMenu}
                        openDiff={openDiff}
                        openFileHistory={openFileHistory}
                        openFileBlame={openFileBlame}
                        handleOpenMergeEditor={handleOpenMergeEditor}
                        handleConflictResolved={handleConflictResolved}
                        selectCommit={selectCommit}
                        showPrompt={showPrompt}
                        loc={loc}
                      />
                    )}
                  </section>
                }
              />
            )}

            {!hasRepo && <RepoManager state={state} />}
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
        <SgContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={closeContextMenu} />
      )}

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
          sourceBranch={mergeState?.sourceBranch || ''}
          targetBranch={mergeState?.targetBranch || ''}
          onResolved={() => { setMergeEditorFile(null); handleConflictResolved(mergeEditorFile); }}
          onCancel={() => setMergeEditorFile(null)}
        />
      )}

      {mergeDialogSource && (
        <MergeDialog
          source={mergeDialogSource}
          target={state.currentBranch}
          onClose={() => setMergeDialogSource(null)}
        />
      )}

      <SgPromptDialog prompt={prompt} onClose={closePrompt} />
      <SgToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

/* ─── Sub-components ─── */

function TitleBar({ loc, page, setPage, lang, toggleLang, theme, toggleTheme }: {
  loc: ReturnType<typeof t>;
  page: Page; setPage: (p: Page) => void;
  lang: string; toggleLang: () => void;
  theme: string; toggleTheme: () => void;
}) {
  return (
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
  );
}

function CommitsView({ state, commitDetail, diffTarget, rightPanel, setRightPanel, selectCommit, openDiff, openFileHistory, openFileBlame, showContextMenu, showPrompt, setRebaseOnto }: {
  state: any; commitDetail: any; diffTarget: any;
  rightPanel: RightPanel; setRightPanel: (p: RightPanel) => void;
  selectCommit: (hash: string) => void;
  openDiff: (file: string, hash: string) => void;
  openFileHistory: (file: string) => void;
  openFileBlame: (file: string, hash?: string) => void;
  showContextMenu: (e: React.MouseEvent, items: any[]) => void;
  showPrompt: any;
  setRebaseOnto: (onto: string | null) => void;
}) {
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
          onLoadMore={() => postCommand({ type: 'getGraphData', maxCount: state.commits.length + 2000 })}
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

function ChangesView({ state, mergeState, diffTarget, rightPanel, setRightPanel, conflictFile, setConflictFile, setMergeEditorFile, showContextMenu, openDiff, openFileHistory, openFileBlame, handleOpenMergeEditor, handleConflictResolved, selectCommit, showPrompt, loc }: {
  state: any; mergeState: any; diffTarget: any;
  rightPanel: RightPanel; setRightPanel: (p: RightPanel) => void;
  conflictFile: string | null; setConflictFile: (f: string | null) => void;
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
}) {
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
            onResolved={() => handleConflictResolved(conflictFile!)}
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

function RightPanelContent({ rightPanel, setRightPanel, diffTarget, selectCommit, openDiff }: {
  rightPanel: RightPanel; setRightPanel: (p: RightPanel) => void;
  diffTarget: { file: string; hash: string };
  selectCommit: (hash: string) => void;
  openDiff: (file: string, hash: string) => void;
}) {
  if (rightPanel === 'history') {
    return <FileHistory file={diffTarget.file} onOpenDiff={(f, h) => { openDiff(f, h); setRightPanel('diff'); }} />;
  }
  if (rightPanel === 'blame') {
    return <BlameView file={diffTarget.file} hash={diffTarget.hash} onSelectCommit={selectCommit} />;
  }
  return <DiffPanel file={diffTarget.file} hash={diffTarget.hash} />;
}
