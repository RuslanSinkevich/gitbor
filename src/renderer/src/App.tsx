import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { useAppState } from './hooks/useAppState';
import { useDiffState } from './hooks/useDiffState';
import { useTheme } from './hooks/useTheme';
import { useToasts } from './hooks/useToasts';
import { useContextMenu } from './hooks/useContextMenu';
import { useMenuActions } from './hooks/useMenuActions';
import { useOperationToasts } from './hooks/useOperationToasts';
import { useSafetyDialog } from './hooks/useSafetyDialog';
import { countCheckoutDirty, useCheckout } from './features/checkout';
import { useApplyStash } from './features/stash';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useDialogs } from './hooks/useDialogs';
import { useAutoFetch } from './hooks/useAutoFetch';
import { useSyncActions } from './hooks/useSyncActions';
import { TitleBar } from './features/titlebar';
import { CommitsView, ChangesView, type RightPanel } from './features/layout';
import { MergeBanner, shouldShowMergeBanner } from './features/merge';
import { Toolbar } from './features/toolbar';
import { Sidebar, BranchStatus } from './features/sidebar';
import { RepoTabs } from './features/repo-tabs';
import { RepoManager, addRecentRepo, loadLastActiveRepo, saveLastActiveRepo, clearLastActiveRepo, removeRecentRepo, findRepoIndexByPath, loadOpenRepos, saveOpenRepos } from './features/repo-manager';
import { SgSplitPane } from './ui/SgSplitPane';
import { usePromptDialog } from './ui/SgPromptDialog';
import { AppDialogs } from './AppDialogs';
import { postCommand, onMainEvent, invokeCommand, onRetryableCommand } from './api';
import { t, tpl, setLang, getLang } from './i18n';
// UiShowcase — dev-only страница UI-Kit, рендерится только при page === 'ui-kit'.
// Lazy-load экономит ~десятки кБ из основного бандла (showcase секции импортят
// демо-данные графа, токены, кучу sg-компонентов разом).
const UiShowcase = lazy(() => import('./pages/UiShowcase').then(m => ({ default: m.UiShowcase })));
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
  // RepoManager как «вкладка»: «+» в RepoTabs включает этот флаг и
  // показывает менеджер поверх workspace, не открывая системный диалог.
  // Переключение на ДРУГОЙ репо-таб тоже его открывает (см.
  // handleSwitchRepo — UX как при «+»). Клик по уже активному табу
  // сбрасывает флаг, давая выход в workspace.
  const [showRepoManager, setShowRepoManager] = useState(false);
  const dlg = useDialogs();
  const loc = t();
  const { runPull, runPush, syncDialogs } = useSyncActions(state, loc);

  // SafetyDialog: подписан на lastOpResult по errorClass; решает,
  // открывать ли модал. useOperationToasts глушит дублирующие toast'ы.
  const safety = useSafetyDialog();
  const lastCommandRef = useRef<import('./types').RendererCommand | null>(null);

  useEffect(() => {
    const unsub = onRetryableCommand((cmd) => { lastCommandRef.current = cmd; });
    return unsub;
  }, []);

  useEffect(() => {
    if (!lastOpResult || lastOpResult.success || !lastOpResult.errorClass) return;
    if (!safety.shouldOpenModal({
      errorClass: lastOpResult.errorClass,
      severity: lastOpResult.severity,
      source: lastOpResult.source,
    })) return;
    safety.enqueue({
      operation: lastOpResult.operation,
      errorClass: lastOpResult.errorClass,
      error: lastOpResult.error || '',
      severity: lastOpResult.severity,
      source: lastOpResult.source,
      savedState: lastOpResult.savedState,
      preflightIssues: lastOpResult.preflightIssues,
      suggestedActions: lastOpResult.suggestedActions,
      retryCommand: lastCommandRef.current ?? undefined,
    });
  }, [lastOpResult, safety]);

  useOperationToasts(
    lastOpResult, clearLastOpResult, addToast, lastCommandRef,
    () => dlg.setShowGitActivity(true),
    {
      // Подавляем toast если эту же ошибку покажет SafetyDialog —
      // иначе модалка и toast дублируют один stderr.
      willShowModal: ({ errorClass, severity, source }) =>
        safety.shouldOpenModal({ errorClass, severity, source }),
    },
  );
  useAutoFetch(
    state.repoPath,
    !!state.repoPath,
    (msg) => addToast(msg, 'info'),
    (msg, retry) => addToast(msg, 'info', { label: t().autoFetch.retryNow, onClick: retry }),
  );

  const handleOpenMergeDialog = useCallback((source: string) => {
    setMergeDialogSource(source);
  }, []);

  /**
   * Stash через модалку: пустое имя → `git stash push` без `-m`,
   * непустое → `git stash push -m <message>`. Используется и из тулбара,
   * и из меню/горячих клавиш (через useMenuActions).
   */
  const promptStash = useCallback(() => {
    showPrompt({
      title: loc.stashDialog.title,
      label: loc.stashDialog.label,
      placeholder: loc.stashDialog.placeholder,
      confirmLabel: loc.stashDialog.confirm,
      allowEmpty: true,
      onConfirm: (value) => {
        const trimmed = value.trim();
        postCommand({ type: 'stash', message: trimmed || undefined });
      },
    });
  }, [showPrompt, loc.stashDialog]);

  const handleMenuAction = useMenuActions({
    state, setViewMode, ...dlg, showPrompt, promptStash, handleOpenMergeDialog, runPull, runPush,
  });

  /**
   * Хоткеи переключения вкладок. Хост-компонент держит реальный
   * `switchRepoFast` и список openRepos, поэтому формирует actions здесь
   * (хук сам про репо ничего не знает). Switch напрямую через
   * `switchRepoFast`, минуя `handleSwitchRepo` — последний открывает
   * RepoManager при свитче, что для хоткея неуместно (юзер ждёт
   * мгновенного перехода в workspace выбранного репо).
   */
  const tabActions = useMemo(() => ({
    openReposCount: state.openRepos.length,
    switchToTab: (index: number) => {
      if (index >= 0 && index < state.openRepos.length && index !== state.activeRepoIndex) {
        switchRepoFast(index);
      }
    },
    nextTab: () => {
      const n = state.openRepos.length;
      if (n <= 1) return;
      switchRepoFast((state.activeRepoIndex + 1) % n);
    },
    prevTab: () => {
      const n = state.openRepos.length;
      if (n <= 1) return;
      switchRepoFast((state.activeRepoIndex - 1 + n) % n);
    },
  }), [state.openRepos.length, state.activeRepoIndex, switchRepoFast]);

  useKeyboardShortcuts(handleMenuAction, tabActions);

  const restoreLastRepoAttempted = useRef(false);

  // Восстанавливаем СПИСОК открытых табов. Запускаем один раз — открываем
  // каждый сохранённый путь через `openRepo`, main сам сложит их в openRepos.
  // Last active восстанавливаем как fallback (если openRepos пуст, для старых
  // юзеров без OPEN_REPOS_KEY в localStorage).
  useEffect(() => {
    if (restoreLastRepoAttempted.current) return;
    restoreLastRepoAttempted.current = true;

    const openPaths = loadOpenRepos();
    const last = loadLastActiveRepo();

    if (openPaths.length > 0) {
      for (const p of openPaths) {
        void invokeCommand({ type: 'openRepo', path: p }).catch(() => {
          // tихо игнорим: репо удалили/переименовали — следующий saveOpenRepos
          // перепишет список без него (после рендера на актуальном state.openRepos).
        });
      }
      return;
    }

    if (last && !state.repoPath) {
      void invokeCommand({ type: 'openRepo', path: last }).catch(() => {
        clearLastActiveRepo();
        removeRecentRepo(last);
      });
    }
  }, []);

  useEffect(() => {
    if (state.repoPath && state.repoName) {
      saveLastActiveRepo(state.repoPath);
      addRecentRepo(state.repoName, state.repoPath);
    }
  }, [state.repoPath, state.repoName]);

  // Пишем актуальный openRepos в localStorage на каждое изменение.
  // Дешёво (массив строк, <50 элементов), синхронно при close/open табов.
  useEffect(() => {
    if (!restoreLastRepoAttempted.current) return;
    saveOpenRepos(state.openRepos.map(r => r.path));
  }, [state.openRepos]);

  // Restore активного таба по сохранённому path. Запускается один раз
  // когда openRepos впервые становится непустым (либо сразу после старта
  // если main отдал список, либо после рендер-side openRepo). Сравниваем
  // по path (sameRepoPath нормализует слэши/регистр) — индекс между
  // сессиями нестабилен (порядок открытия/закрытия меняется).
  const restoreActiveTabAttempted = useRef(false);
  useEffect(() => {
    if (restoreActiveTabAttempted.current) return;
    if (state.openRepos.length === 0) return;
    const last = loadLastActiveRepo();
    if (!last) {
      restoreActiveTabAttempted.current = true;
      return;
    }
    const idx = findRepoIndexByPath(state.openRepos, last);
    if (idx >= 0 && idx !== state.activeRepoIndex) {
      switchRepoFast(idx);
    }
    restoreActiveTabAttempted.current = true;
  }, [state.openRepos, state.activeRepoIndex, switchRepoFast]);

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

    // Запрашиваем mergeState при переключении/открытии нового репо:
    // если в репо уже есть активный merge/cherry-pick/rebase/UU — UI
    // увидит баннер сразу, а не только после следующего write-op'а.
    if (state.repoPath) {
      postCommand({ type: 'getMergeState' });
    }

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
  /** Один путь в индексе и в рабочей копии — одна позиция в бейдже/статусбаре. */
  const localChangesCount = useMemo(() => {
    const paths = new Set<string>();
    for (const f of state.stagedFiles) paths.add(f.path);
    for (const f of state.unstagedFiles) paths.add(f.path);
    return paths.size;
  }, [state.stagedFiles, state.unstagedFiles]);
  const checkoutDirtyCount = useMemo(
    () => countCheckoutDirty(state.stagedFiles, state.unstagedFiles),
    [state.stagedFiles, state.unstagedFiles],
  );
  const { requestCheckout, checkoutDialog } = useCheckout(checkoutDirtyCount > 0, checkoutDirtyCount);
  const { requestApplyStash, applyStashDialog } = useApplyStash();
  // Показываем менеджер если юзер явно его открыл («+») ИЛИ если нет
  // открытых репо вовсе (RepoManager — единственный осмысленный экран).
  const repoManagerVisible = showRepoManager || !hasRepo;

  // Авто-сброс «+»-вкладки при появлении нового репо: если из RepoManager
  // юзер открыл existing/new репо, openRepos увеличится и main переключит
  // активный таб на новый — UX-логично сразу уйти из менеджера в workspace.
  const prevOpenReposCountRef = useRef<number>(state.openRepos.length);
  useEffect(() => {
    const prev = prevOpenReposCountRef.current;
    const curr = state.openRepos.length;
    prevOpenReposCountRef.current = curr;
    if (curr > prev && showRepoManager) {
      setShowRepoManager(false);
    }
  }, [state.openRepos.length, showRepoManager]);

  // Клик по репо-табу: просто переключаем активный репо в workspace.
  // RepoManager показываем только по «+» (handleShowRepoManager) или
  // когда вообще нет открытых репо (repoManagerVisible).
  const handleSwitchRepo = useCallback((index: number) => {
    if (showRepoManager) setShowRepoManager(false);
    if (index === state.activeRepoIndex) return;
    switchRepoFast(index);
  }, [switchRepoFast, state.activeRepoIndex, showRepoManager]);

  const handleShowRepoManager = useCallback(() => {
    setShowRepoManager(true);
  }, []);

  // Drag&drop: дроп папок из ОС → openRepo на каждую. Папка определяется
  // через `webkitGetAsEntry().isDirectory` (надёжнее чем по File.size,
  // который у директорий часто 0, но и у пустых файлов тоже).
  // Файл (не папка) → toast-подсказка вместо openRepo, иначе main падал
  // бы на `git rev-parse` любого случайного файла.
  const [isDraggingFolder, setIsDraggingFolder] = useState(false);
  const dragDepthRef = useRef(0);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  // dragenter/dragleave фолят при движении внутри детей: enter/leave
  // стреляются КАЖДЫЙ раз при пересечении границы вложенного элемента.
  // Считаем глубину как счётчик, чтобы overlay не моргал.
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) setIsDraggingFolder(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFolder(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFolder(false);

    const items = e.dataTransfer ? Array.from(e.dataTransfer.items) : [];
    const folderPaths: string[] = [];
    let droppedFiles = 0;
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      const file = item.getAsFile();
      // Electron-specific: у File из ОС-перетаскивания есть .path (абсолютный).
      const fsPath = (file as (File & { path?: string }) | null)?.path;
      if (entry?.isDirectory && fsPath) {
        folderPaths.push(fsPath);
      } else {
        droppedFiles += 1;
      }
    }

    if (folderPaths.length === 0) {
      if (droppedFiles > 0) addToast(loc.repoTabs.dnd.onlyFolders, 'info');
      return;
    }
    for (const p of folderPaths) {
      postCommand({ type: 'openRepo', path: p });
    }
  }, [addToast, loc.repoTabs.dnd.onlyFolders]);

  return (
    <div
      className={s.app}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <TitleBar
        loc={loc} page={page} setPage={setPage}
        lang={lang} toggleLang={toggleLang}
        theme={theme} toggleTheme={toggleTheme}
        onMenuAction={handleMenuAction}
        onOpenRepo={() => postCommand({ type: 'openRepoDialog' })}
      />

      {page === 'ui-kit' && (
        <Suspense fallback={<div className={s.lazyFallback}>{loc.app.loading}</div>}>
          <UiShowcase />
        </Suspense>
      )}

      {page === 'app' && (
        <>
          <RepoTabs
            repos={state.openRepos}
            activeIndex={state.activeRepoIndex}
            hasChanges={localChangesCount > 0}
            onSwitch={handleSwitchRepo}
            managerActive={repoManagerVisible}
            onShowManager={handleShowRepoManager}
            onContextMenu={showContextMenu}
          />

          {hasRepo && !repoManagerVisible && (
            <Toolbar
              isOperationRunning={state.isOperationRunning}
              hasUpstream={state.branches.some(b => b.isCurrent && b.upstream)}
              ahead={state.ahead}
              behind={state.behind}
              onPull={runPull}
              onPush={runPush}
              onStash={promptStash}
              onOpenActivity={() => dlg.setShowGitActivity(true)}
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
                      localChangesCount={localChangesCount}
                      activeView={viewMode}
                      onContextMenu={showContextMenu} onSwitchView={setViewMode}
                      onSelectRef={handleSelectRef} onMerge={handleOpenMergeDialog}
                      showPrompt={showPrompt} requestCheckout={requestCheckout}
                      requestApplyStash={requestApplyStash}
                      selectedRefHash={state.selectedCommitHash}
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
                        requestCheckout={requestCheckout}
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
            )}
          </main>

          <footer className={s.statusbar}>
            {hasRepo && !repoManagerVisible ? (
              <BranchStatus
                currentBranch={state.currentBranch} ahead={state.ahead} behind={state.behind}
                localChangesCount={localChangesCount}
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
        safety={safety}
      />

      {syncDialogs}
      {checkoutDialog}
      {applyStashDialog}

      {isDraggingFolder && (
        <div className={s.dropOverlay}>{loc.repoTabs.dnd.hint}</div>
      )}
    </div>
  );
}
