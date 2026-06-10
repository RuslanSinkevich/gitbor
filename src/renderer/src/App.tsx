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
import { useApplyStash, StashCreateDialog } from './features/stash';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useDialogs } from './hooks/useDialogs';
import { useAutoFetch } from './hooks/useAutoFetch';
import { useSyncActions } from './hooks/useSyncActions';
import { isPushDefaultMismatch } from './hooks/pushDestination';
import { useRestoreRepoTabs } from './hooks/useRestoreRepoTabs';
import { useFolderDropOpenRepos } from './hooks/useFolderDropOpenRepos';
import { useAppUpdater } from './hooks/useAppUpdater';
import { TitleBar } from './features/titlebar';
import type { RightPanel } from './features/layout';
import { BranchInfoDialog } from './features/sidebar';
import { useBranchPrefs } from './hooks/useBranchPrefs';
import type { Branch } from './types';
import { useSupportPrompt } from './features/support';
import { usePromptDialog } from './ui/SgPromptDialog';
import { AppDialogs } from './AppDialogs';
import { postCommand, onMainEvent, onRetryableCommand } from './api';
import { t, setLang, getLang } from './i18n';
// UiShowcase — dev-only страница UI-Kit, рендерится только при page === 'ui-kit'.
// Lazy-load экономит ~десятки кБ из основного бандла (showcase секции импортят
// демо-данные графа, токены, кучу sg-компонентов разом).
const UiShowcase = lazy(() => import('./pages/UiShowcase').then(m => ({ default: m.UiShowcase })));
const SupportDialog = lazy(() => import('./features/support').then(m => ({ default: m.SupportDialog })));
const AppWorkspace = lazy(() => import('./features/app-shell/AppWorkspace').then(m => ({ default: m.AppWorkspace })));
import s from './App.module.css';

type Page = 'app' | 'ui-kit';
type ViewMode = 'changes' | 'commits';

/**
 * Имена операций (как они приходят в `lastOpResult.operation` от main),
 * после успешного завершения которых открытый diff гарантированно
 * становится устаревшим. Имена синхронизированы со строками в
 * `op('<name>', …)` / `opWithPostMerge('<name>', …)` в
 * `src/core/bridge/ipc/handlersGitOps.ts` и `handlersRepoExtras.ts`.
 */
const STALE_DIFF_OPS = new Set<string>([
  'commit',
  'merge',
  'pull',
  'stash',
  'stashPop',
  'cherry-pick',
  'revert',
  'reset',
  'rebase',
  'checkout',
  'restoreReflog',
]);

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
  useAppUpdater(showPrompt);
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
  /* Счётчик запросов фокуса графа: бампается на каждый клик по ветке/рефу,
     даже если выбран тот же commit. CommitGraph по его смене доскроллит к
     выбранному (иначе повторный клик по той же ветке не реагировал). */
  const [graphFocusNonce, setGraphFocusNonce] = useState(0);
  /* Репо использует LFS (есть filter=lfs в .gitattributes) — для контекстного
     показа пункта «Git LFS…» в меню. Пересчитывается при смене репо. */
  const [usesLfs, setUsesLfs] = useState(false);
  const [page, setPage] = useState<Page>('app');
  const [lang, setLangState] = useState(getLang);
  /* Branch info dialog: текущая выбранная ветка показывается через SgDialog,
     данные из стейта + getCommitDetails. setOpenInfoBranch(null) — закрыть. */
  const [openInfoBranch, setOpenInfoBranch] = useState<Branch | null>(null);
  const branchPrefsState = useBranchPrefs(state.repoPath);
  /* Стабильный объект-фасад для Sidebar/BranchTree. useMemo — чтобы не
     ломать React.memo / identity-зависимые useMemo внутри (поля self-bind
     уже стабильны из useCallback в useBranchPrefs). */
  const branchPrefsAPI = useMemo(() => ({
    pinned: branchPrefsState.pinned,
    hidden: branchPrefsState.hidden,
    soloBranch: branchPrefsState.soloBranch,
    notes: branchPrefsState.notes,
    togglePin: branchPrefsState.togglePin,
    toggleHide: branchPrefsState.toggleHide,
    toggleSolo: (name: string) => branchPrefsState.setSoloBranch(name),
    clearSolo: () => branchPrefsState.setSoloBranch(null),
    showInfo: (b: Branch) => setOpenInfoBranch(b),
    renameBranch: branchPrefsState.renameBranch,
  }), [branchPrefsState]);
  // RepoManager как «вкладка»: «+» в RepoTabs включает этот флаг и
  // показывает менеджер поверх workspace, не открывая системный диалог.
  // Переключение на ДРУГОЙ репо-таб тоже его открывает (см.
  // handleSwitchRepo — UX как при «+»). Клик по уже активному табу
  // сбрасывает флаг, давая выход в workspace.
  const [showRepoManager, setShowRepoManager] = useState(false);
  const dlg = useDialogs();
  const loc = t();
  const { runPull, runPush, openPushDialog, syncDialogs } = useSyncActions(state, loc);

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

  // Push провалился с fatal про расхождение имени локальной ветки и upstream
  // (push.default=simple). Вместо «неизвестной ошибки» снова открываем диалог
  // Push, где юзер явно выбирает remote + целевую ветку. Toast при этом
  // подавлен через willShowModal выше.
  useEffect(() => {
    if (!lastOpResult || lastOpResult.success) return;
    if (lastOpResult.operation !== 'push') return;
    if (!isPushDefaultMismatch(lastOpResult.error)) return;
    openPushDialog();
  }, [lastOpResult, openPushDialog]);

  useOperationToasts(
    lastOpResult, clearLastOpResult, addToast, lastCommandRef,
    () => dlg.setShowGitActivity(true),
    {
      // Подавляем toast если эту же ошибку покажет SafetyDialog —
      // иначе модалка и toast дублируют один stderr. Также глушим generic-
      // toast при mismatch upstream у push: его обрабатывает повторный
      // диалог Push (см. эффект ниже).
      willShowModal: ({ errorClass, severity, source, operation, error }) =>
        safety.shouldOpenModal({ errorClass, severity, source }) ||
        (operation === 'push' && isPushDefaultMismatch(error)),
    },
  );

  /**
   * Stale diff guard: после write-операций, меняющих рабочую копию /
   * индекс / HEAD, текущий открытый diff почти всегда невалиден
   * (файл могли удалить/переименовать/закоммитить/откатить). Закрываем
   * правую панель — пусть юзер выберет файл заново. Один эффект на
   * `lastOpResult` покрывает все handlersGitOps/handlersRepoExtras,
   * которые шлют `operationEnd` через `op()`/`opWithPostMerge()` —
   * проверять каждый handler отдельно избыточно и хрупко.
   *
   * Сюда не включены: fetch, push, addRemote, deleteBranch/Tag,
   * createBranch, clone, init, submoduleInit/Update — они не трогают
   * working tree активного diff. stageHunk/discardHunk/stageLines
   * идут через `errOnFail` без `operationEnd` и закрываются эффектом
   * выше по stagedFiles/unstagedFiles.
   */
  useEffect(() => {
    if (!lastOpResult || !lastOpResult.success) return;
    if (!STALE_DIFF_OPS.has(lastOpResult.operation)) return;
    closeDiff();
  }, [lastOpResult, closeDiff]);

  /**
   * После успешного коммита/пуша авто-фокусируем tip текущей ветки в графе —
   * «авто-клик» по коммиту. Для `commit` tip новый (появился коммит); для
   * `push` tip тот же, но на нём появляется свежая remote-плашка
   * (`origin/<branch>`) — это и есть «новая запись», на которую нужно встать.
   *
   * `commit` через `opWithPostMerge` шлёт обновление веток ДО `operationEnd`
   * по одному IPC-каналу по порядку, поэтому к смене `lastOpResult` tip уже
   * свежий. Бампаем `graphFocusNonce`, а не только selectCommit: после push
   * выбранным мог уже быть tip — без bump'а граф не доскроллит к нему.
   *
   * Ref-гард по идентичности `lastOpResult` (новый объект на каждый
   * operationEnd) защищает от повторной отработки, когда смена
   * selectedCommitHash перезапускает эффект с тем же результатом.
   */
  const focusedOpRef = useRef<typeof lastOpResult>(null);
  useEffect(() => {
    if (!lastOpResult || !lastOpResult.success) return;
    if (lastOpResult.operation !== 'commit' && lastOpResult.operation !== 'push') return;
    if (focusedOpRef.current === lastOpResult) return;
    focusedOpRef.current = lastOpResult;
    const tip = state.branches.find(b => b.isCurrent && !b.isRemote)?.hash;
    if (!tip) return;
    if (tip !== state.selectedCommitHash) selectCommit(tip);
    setGraphFocusNonce(n => n + 1);
  }, [lastOpResult, state.branches, state.selectedCommitHash, selectCommit]);

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
   *
   * Отдельный `StashCreateDialog` (а не SgPromptDialog) нужен ради
   * AI-кнопки «Предложить имя» рядом с input'ом — её невозможно
   * втиснуть в универсальный prompt-dialog без раздувания его API.
   */
  const [showStashDialog, setShowStashDialog] = useState(false);
  const promptStash = useCallback(() => {
    setShowStashDialog(true);
  }, []);
  const handleStashSubmit = useCallback((message: string) => {
    postCommand({ type: 'stash', message: message || undefined });
  }, []);

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

  const { isRestoringTabs } = useRestoreRepoTabs({
    repoPath: state.repoPath,
    repoName: state.repoName,
    openRepos: state.openRepos,
    activeRepoIndex: state.activeRepoIndex,
    switchRepoFast,
  });

  // Контекстный признак LFS: при смене репо сбрасываем и перезапрашиваем.
  useEffect(() => {
    setUsesLfs(false);
    if (state.repoPath) postCommand({ type: 'getLfsActive' });
  }, [state.repoPath]);
  useEffect(() => onMainEvent((msg) => {
    if (msg.type === 'lfsActive') setUsesLfs(msg.active);
  }), []);

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
    if (!diffTarget) return;
    const { file, hash } = diffTarget;
    // Действуем только на дифф рабочей копии/индекса; дифф коммита (hash —
    // sha) живёт по своему ключу и чистится отдельным эффектом.
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
  }, [state.unstagedFiles, state.stagedFiles, diffTarget, closeDiff]);

  useEffect(() => {
    const wasInProgress = prevMergeRef.current;
    const isNow = !!mergeState?.inProgress;
    const firstConflicted = mergeState?.conflictFiles.find(f => f.status === 'conflicted') ?? null;
    if (isNow && !wasInProgress) {
      if (firstConflicted) { setViewMode('changes'); setConflictFile(firstConflicted.path); }
    } else if (isNow && conflictFile) {
      const stillConflicted = mergeState!.conflictFiles.some(
        f => f.status === 'conflicted' && f.path === conflictFile,
      );
      if (!stillConflicted) {
        setConflictFile(firstConflicted?.path ?? null);
        setMergeEditorFile(null);
        closeDiff();
      }
    } else if (isNow && firstConflicted) {
      setConflictFile(firstConflicted.path);
    }
    if (!isNow && wasInProgress) { setConflictFile(null); setMergeEditorFile(null); closeDiff(); }
    prevMergeRef.current = isNow;
  }, [mergeState, conflictFile, closeDiff]);

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
    let done = false;
    let safety: ReturnType<typeof setTimeout> | null = null;
    const unsub = onMainEvent((msg) => {
      if (done) return;
      if (msg.type === 'mergeState') {
        if (msg.repoPath !== state.repoPath) return;
        done = true;
        unsub();
        if (safety) clearTimeout(safety);
        const next = msg.data.conflictFiles.find(f => f.status === 'conflicted' && f.path !== resolvedPath);
        setConflictFile(next ? next.path : null);
      }
    });
    // Safety: если main не пришлёт mergeState (IPC dropped / repo closed
    // в этот момент), listener иначе остаётся в глобальном массиве навсегда.
    // На сессии с десятками resolve это копится — отписываемся через 3 с.
    safety = setTimeout(() => {
      if (done) return;
      done = true;
      unsub();
    }, 3000);
    postCommand({ type: 'getMergeState' });
  }, [state.repoPath]);

  const handleSelectRef = useCallback((hash: string) => {
    setViewMode('commits'); setRightPanel('diff'); closeDiff(); selectCommit(hash);
    setGraphFocusNonce(n => n + 1);
  }, [selectCommit, closeDiff]);

  const handleCompareTo = useCallback((fromHash: string, toHash: string) => {
    setViewMode('commits');
    setRightPanel('diff');
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
      if (viewMode === 'commits') {
        if (commitDetail!.files.length > 0) {
          openDiff(commitDetail!.files[0].path, commitDetail!.hash);
        } else {
          // Коммит без файлов (пустой / merge без изменений): нет файла для
          // диффа — закрываем, иначе висит дифф предыдущего коммита.
          closeDiff();
        }
      }
    } else if (newHash === null && prevCommitHashRef.current !== null) {
      // Выбор коммита сброшен (или коммит исчез из истории) — чистим дифф,
      // чтобы в нижней панели не оставался файл уже неактуального коммита.
      prevCommitHashRef.current = null;
      if (viewMode === 'commits') closeDiff();
    }
  }, [commitDetail, viewMode, openDiff, closeDiff]);

  /**
   * Переход commits → changes: дифф выбранного коммита (hash = sha) не относится
   * к рабочей копии, и в changes-view (где может вообще не быть локальных файлов)
   * висел бы как «старый» дифф. Чистим только коммит-дифф в панели diff —
   * рабочие/индексные дифы (WORKING/STAGED) и file-history внутри changes
   * (свой sha-дифф) не трогаем. Срабатывает строго на смену viewMode.
   */
  const prevViewModeRef = useRef<ViewMode>(viewMode);
  useEffect(() => {
    const prev = prevViewModeRef.current;
    prevViewModeRef.current = viewMode;
    if (prev === viewMode) return;
    if (
      viewMode === 'changes' &&
      rightPanel === 'diff' &&
      diffTarget &&
      diffTarget.hash !== 'WORKING' &&
      diffTarget.hash !== 'STAGED'
    ) {
      closeDiff();
    }
  }, [viewMode, rightPanel, diffTarget, closeDiff]);

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

  // Ненавязчивое «спасибо автору»: показываем не чаще раза в неделю и только
  // когда пользователь реально работает с репо (не на экране менеджера).
  const supportPrompt = useSupportPrompt(hasRepo && !repoManagerVisible);

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

  const {
    isDraggingFolder,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  } = useFolderDropOpenRepos({
    addToast,
    onlyFoldersMessage: loc.repoTabs.dnd.onlyFolders,
  });

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
        usesLfs={usesLfs}
      />

      {page === 'ui-kit' && (
        <Suspense fallback={<div className={s.lazyFallback}>{loc.app.loading}</div>}>
          <UiShowcase />
        </Suspense>
      )}

      {page === 'app' && (
        <Suspense fallback={<div className={s.lazyFallback}>{loc.app.loading}</div>}>
          <AppWorkspace
            loc={loc}
            isRestoringTabs={isRestoringTabs}
            state={state}
            hasRepo={hasRepo}
            localChangesCount={localChangesCount}
            repoManagerVisible={repoManagerVisible}
            viewMode={viewMode}
            setViewMode={setViewMode}
            rightPanel={rightPanel}
            setRightPanel={setRightPanel}
            commitDetail={commitDetail}
            diffTarget={diffTarget}
            mergeState={mergeState}
            rebaseProgress={rebaseProgress}
            conflictFile={conflictFile}
            setConflictFile={setConflictFile}
            setMergeEditorFile={setMergeEditorFile}
            setRebaseOnto={setRebaseOnto}
            compareFromHash={compareFromHash}
            setCompareFromHash={setCompareFromHash}
            graphFocusNonce={graphFocusNonce}
            soloBranch={branchPrefsState.soloBranch}
            hiddenBranches={branchPrefsState.hidden}
            branchPrefs={branchPrefsAPI}
            onClearSolo={() => branchPrefsState.setSoloBranch(null)}
            onClearAllHidden={branchPrefsState.clearAllHidden}
            onSwitchRepo={handleSwitchRepo}
            onShowRepoManager={handleShowRepoManager}
            onContextMenu={showContextMenu}
            onPull={runPull}
            onPush={runPush}
            onStash={promptStash}
            onOpenActivity={() => dlg.setShowGitActivity(true)}
            onSelectCommit={selectCommit}
            onSelectRef={handleSelectRef}
            onMerge={handleOpenMergeDialog}
            showPrompt={showPrompt}
            requestCheckout={requestCheckout}
            requestApplyStash={requestApplyStash}
            openDiff={openDiff}
            closeDiff={closeDiff}
            openFileHistory={openFileHistory}
            openFileBlame={openFileBlame}
            onOpenMergeEditor={handleOpenMergeEditor}
            onConflictResolved={handleConflictResolved}
            onCompareTo={handleCompareTo}
            onOpenAiSettings={() => dlg.setShowAiSettings(true)}
            onOpenGitignoreDialog={() => dlg.setShowGitignore(true)}
            onExpandDiff={(f, h) => dlg.setCompareTarget({ file: f, hash: h })}
          />
        </Suspense>
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
        onSayThanks={supportPrompt.openManually}
      />

      {syncDialogs}
      {checkoutDialog}
      {applyStashDialog}

      {showStashDialog && (
        <StashCreateDialog
          onClose={() => setShowStashDialog(false)}
          onSubmit={handleStashSubmit}
        />
      )}

      <BranchInfoDialog
        open={!!openInfoBranch}
        branch={openInfoBranch}
        initialNote={openInfoBranch ? branchPrefsState.notes[openInfoBranch.name] ?? '' : ''}
        onSave={(text) => {
          if (openInfoBranch) branchPrefsState.setNote(openInfoBranch.name, text);
        }}
        onClose={() => setOpenInfoBranch(null)}
      />

      {supportPrompt.open && (
        <Suspense fallback={null}>
          <SupportDialog
            open
            onClose={supportPrompt.close}
            onDismiss={supportPrompt.dismissForever}
          />
        </Suspense>
      )}

      {isDraggingFolder && (
        <div className={s.dropOverlay}>{loc.repoTabs.dnd.hint}</div>
      )}
    </div>
  );
}
