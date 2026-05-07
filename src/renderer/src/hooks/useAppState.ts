import { useState, useCallback, useMemo, useRef } from 'react';
import type { AppState, CommitDetail, MergeState, RebaseProgress, RecoveryIssue } from '../types';
import { postCommand } from '../api';
import { useRepoSlices, EMPTY_SLICE } from './useRepoSlices';
import { useRunningOps, type OperationResult } from './useRunningOps';
import {
  useStateSubscription,
  type OpenDiffEvent,
  type OpenMergeEditorEvent,
} from './useStateSubscription';

// Реэкспорт публичных типов: внешние потребители (useOperationToasts и пр.)
// импортируют их из 'hooks/useAppState' — фасад сохраняет старую поверхность.
export type { OperationResult } from './useRunningOps';
export type { OpenDiffEvent, OpenMergeEditorEvent } from './useStateSubscription';

/**
 * Фасад app-level state. Оркестрирует три специализированных хука:
 *
 * - `useRepoSlices`         — slices Map + meta (openRepos, activeRepoIndex).
 * - `useRunningOps`         — per-repo running ops + lastOpResult.
 * - `useStateSubscription`  — единый `onMainEvent` listener + dispatcher.
 *
 * Возвращает старый интерфейс: AppState (с derived `isOperationRunning` /
 * `currentOperation`), transient state, switchRepoFast, resetTransientState
 * и набор «clear*»-callback'ов. Потребители (App.tsx, useMenuActions,
 * useKeyboardShortcuts, ChangesView/CommitsView и пр.) ничего не замечают.
 */
export function useAppState() {
  const repoSlices = useRepoSlices();
  const runningOps = useRunningOps();

  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebaseProgress, setRebaseProgress] = useState<RebaseProgress | null>(null);
  const [recoveryIssues, setRecoveryIssues] = useState<readonly RecoveryIssue[]>([]);
  const [pendingOpenDiff, setPendingOpenDiff] = useState<OpenDiffEvent | null>(null);
  const [pendingOpenMergeEditor, setPendingOpenMergeEditor] = useState<OpenMergeEditorEvent | null>(null);
  const [viewOverride, setViewOverride] = useState<'changes' | 'commits' | null>(null);

  /**
   * Унифицированный сброс «висящих» state-ов хука. Зачем: при переключении
   * репо или закрытии активной вкладки в UI оставались артефакты от прошлого
   * контекста — старый `commitDetail`, незакрытые `pendingOpenDiff`, баннеры
   * `mergeState`/`rebaseProgress` от другого репо, тосты `lastOpResult`.
   *
   * НЕ сбрасываем:
   * - `recoveryIssues` — это блокирующий диалог, юзер должен явно ответить
   *   (его нельзя «потерять» при случайном переключении).
   * - `slices` — per-repo, и так очищаются точечно.
   * - `runningOpsByRepo` — per-repo running флаги, активные операции в
   *   фоновых репо чистить нельзя.
   */
  const resetTransientState = useCallback(() => {
    setCommitDetail(null);
    setPendingOpenDiff(null);
    setPendingOpenMergeEditor(null);
    setMergeState(null);
    setRebaseProgress(null);
    setError(null);
    runningOps.clearLastResult();
    setViewOverride(null);
  }, [runningOps]);

  // Ref для использования внутри onMainEvent listener (он создаётся один раз
  // через useEffect и не должен пересоздаваться при изменениях resetTransientState).
  const resetTransientStateRef = useRef(resetTransientState);
  resetTransientStateRef.current = resetTransientState;

  useStateSubscription({
    applyMetaPatch: repoSlices.applyMetaPatch,
    replaceSlice: repoSlices.replaceSlice,
    updateSlice: repoSlices.updateSlice,
    removeSlice: repoSlices.removeSlice,
    slicesRef: repoSlices.slicesRef,
    lastRoutedRepoPathRef: repoSlices.lastRoutedRepoPathRef,
    startOperation: runningOps.startOperation,
    endOperation: runningOps.endOperation,
    removeRunningOpsByRepo: runningOps.removeRepo,
    setCommitDetail,
    setMergeState,
    setError,
    setRebaseProgress,
    setRecoveryIssues,
    setPendingOpenDiff,
    setPendingOpenMergeEditor,
    setViewOverride,
    resetActiveTransient: () => resetTransientStateRef.current(),
  });

  // Производный AppState — единый view по активному срезу + meta. Если
  // активный repo ещё не имеет среза (только что открыт) — показываем EMPTY_SLICE.
  // `isOperationRunning`/`currentOperation` берутся ИСКЛЮЧИТЕЛЬНО от
  // активной вкладки: соседние fetch/push не должны блокировать кнопки тут.
  const state: AppState = useMemo(() => {
    const { meta, slices } = repoSlices;
    const activeRepo = meta.openRepos[meta.activeRepoIndex];
    const slice = activeRepo ? slices.get(activeRepo.path) : undefined;
    const base = slice ?? EMPTY_SLICE;
    const activePath = activeRepo?.path ?? '';
    const currentOp = runningOps.getCurrentOp(activePath);
    return {
      repoPath: base.repoPath || activePath,
      repoName: base.repoName || (activeRepo?.name ?? ''),
      currentBranch: base.currentBranch,
      branches: base.branches,
      tags: base.tags,
      stashes: base.stashes,
      remotes: base.remotes,
      stagedFiles: base.stagedFiles,
      unstagedFiles: base.unstagedFiles,
      conflicts: base.conflicts,
      ahead: base.ahead,
      behind: base.behind,
      commits: base.commits,
      graphLayout: base.graphLayout,
      selectedCommitHash: base.selectedCommitHash,
      isOperationRunning: currentOp !== null,
      currentOperation: currentOp,
      openRepos: meta.openRepos,
      activeRepoIndex: meta.activeRepoIndex,
    };
  }, [repoSlices, runningOps]);

  const selectCommit = useCallback((hash: string | null) => {
    const activeRepoPath = state.repoPath;
    if (activeRepoPath) {
      repoSlices.updateSlice(activeRepoPath, { selectedCommitHash: hash });
    }
    if (hash) {
      postCommand({ type: 'getCommitDetails', hash });
    } else {
      setCommitDetail(null);
    }
  }, [state.repoPath, repoSlices]);

  /**
   * Мгновенное переключение таба. Только меняем `activeRepoIndex` — UI
   * перерисуется на срез нового репо. Если среза нет (первое открытие) —
   * EMPTY_SLICE; данные подтянутся событиями от main. Никаких полей чужого
   * репо в state в момент клика быть не может.
   */
  const switchRepoFast = useCallback((index: number) => {
    repoSlices.setActiveRepoIndex(index);
    resetTransientState();
    postCommand({ type: 'switchRepo', index });
  }, [repoSlices, resetTransientState]);

  const clearError = useCallback(() => setError(null), []);
  const clearViewOverride = useCallback(() => setViewOverride(null), []);
  const clearPendingOpenDiff = useCallback(() => setPendingOpenDiff(null), []);
  const clearPendingOpenMergeEditor = useCallback(() => setPendingOpenMergeEditor(null), []);
  const clearRecoveryIssues = useCallback(() => setRecoveryIssues([]), []);
  const clearLastOpResult = runningOps.clearLastResult;
  const lastOpResult: OperationResult | null = runningOps.lastOpResult;

  return {
    state, commitDetail, mergeState, error, selectCommit, clearError,
    viewOverride, clearViewOverride,
    rebaseProgress,
    recoveryIssues, clearRecoveryIssues,
    pendingOpenDiff, clearPendingOpenDiff,
    pendingOpenMergeEditor, clearPendingOpenMergeEditor,
    lastOpResult, clearLastOpResult,
    switchRepoFast,
    resetTransientState,
  };
}
