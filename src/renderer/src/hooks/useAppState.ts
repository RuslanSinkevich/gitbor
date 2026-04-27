import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppState, CommitDetail, MergeState, MainEvent, RebaseProgress, RecoveryIssue } from '../types';
import { sendReady, postCommand, onMainEvent } from '../api';
import { setLang } from '../i18n';

interface RepoUiSnapshot {
  commits: AppState['commits'];
  graphLayout: AppState['graphLayout'];
}

export interface OpenDiffEvent { file: string; hash: string }
export interface OpenMergeEditorEvent { file: string }
export interface OperationResult { operation: string; success: boolean; error?: string }

const EMPTY_STATE: AppState = {
  repoPath: '',
  repoName: '',
  currentBranch: '',
  branches: [],
  tags: [],
  stashes: [],
  remotes: [],
  stagedFiles: [],
  unstagedFiles: [],
  conflicts: [],
  ahead: 0,
  behind: 0,
  commits: [],
  graphLayout: { nodes: [], maxColumns: 0, mergeLinks: [] },
  selectedCommitHash: null,
  isOperationRunning: false,
  currentOperation: null,
  openRepos: [],
  activeRepoIndex: 0,
};

export function useAppState() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebaseProgress, setRebaseProgress] = useState<RebaseProgress | null>(null);
  const [recoveryIssues, setRecoveryIssues] = useState<readonly RecoveryIssue[]>([]);
  const [pendingOpenDiff, setPendingOpenDiff] = useState<OpenDiffEvent | null>(null);
  const [pendingOpenMergeEditor, setPendingOpenMergeEditor] = useState<OpenMergeEditorEvent | null>(null);
  const [lastOpResult, setLastOpResult] = useState<OperationResult | null>(null);

  // UI-кэш графа по repoPath. Когда приходит graphData от main — запоминаем,
  // при клике на таб мгновенно применяем из кэша (как Fork) не дожидаясь IPC.
  const repoUiCache = useRef<Map<string, RepoUiSnapshot>>(new Map());

  useEffect(() => {
    const unsubscribe = onMainEvent((msg: MainEvent) => {
      switch (msg.type) {
        case 'fullState':
          setState(msg.data);
          break;
        case 'stateUpdate':
          setState(prev => ({ ...prev, ...msg.data }));
          break;
        case 'commitDetails':
          setState(prev => {
            if (prev.selectedCommitHash && (msg.hash === prev.selectedCommitHash || msg.data.hash === prev.selectedCommitHash)) {
              queueMicrotask(() => setCommitDetail(msg.data));
            }
            return prev;
          });
          break;
        case 'graphData': {
          setState(prev => {
            const repoPath = prev.repoPath;
            const incomingCommits = msg.data.commits;
            const incomingLayout = msg.data.layout;

            if (!repoPath) {
              return { ...prev, commits: incomingCommits, graphLayout: incomingLayout };
            }

            // Dedup: если пришли ровно те же данные что уже в кэше этого репо —
            // переиспользуем старые ссылки. Без этого React каждый раз считает
            // commits/graphLayout «новыми», и CommitGraph пересчитывает
            // groupBranchPaths() для 15k коммитов (~100-150ms блок main thread).
            const cached = repoUiCache.current.get(repoPath);
            const sameAsCached =
              cached &&
              cached.commits.length === incomingCommits.length &&
              cached.graphLayout.nodes.length === incomingLayout.nodes.length &&
              cached.commits[0]?.hash === incomingCommits[0]?.hash &&
              cached.commits[cached.commits.length - 1]?.hash ===
                incomingCommits[incomingCommits.length - 1]?.hash;

            if (sameAsCached && cached) {
              if (prev.commits === cached.commits && prev.graphLayout === cached.graphLayout) {
                return prev;
              }
              return { ...prev, commits: cached.commits, graphLayout: cached.graphLayout };
            }

            repoUiCache.current.set(repoPath, {
              commits: incomingCommits,
              graphLayout: incomingLayout,
            });
            return { ...prev, commits: incomingCommits, graphLayout: incomingLayout };
          });
          break;
        }
        case 'operationStart':
          setState(prev => ({
            ...prev,
            isOperationRunning: true,
            currentOperation: msg.operation,
          }));
          break;
        case 'operationEnd':
          setState(prev => ({
            ...prev,
            isOperationRunning: false,
            currentOperation: null,
          }));
          setLastOpResult({ operation: msg.operation, success: msg.success, error: msg.error });
          break;
        case 'config':
          setLang(msg.lang);
          break;
        case 'mergeState':
          setMergeState(msg.data);
          break;
        case 'mergeCompleted':
        case 'mergeAborted':
          setMergeState(null);
          break;
        case 'showView':
          setViewOverride(msg.view);
          break;
        case 'rebaseProgress':
          setRebaseProgress(msg.data);
          break;
        case 'recoveryRequired':
          setRecoveryIssues(msg.issues);
          break;
        case 'openDiff':
          setPendingOpenDiff({ file: msg.file, hash: msg.hash });
          break;
        case 'openMergeEditor':
          setPendingOpenMergeEditor({ file: msg.file });
          break;
        case 'repoClosed':
          repoUiCache.current.delete(msg.path);
          break;
        case 'error':
          setError(msg.message);
          break;
      }
    });

    sendReady();
    return () => { unsubscribe(); };
  }, []);

  const selectCommit = useCallback((hash: string | null) => {
    setState(prev => ({ ...prev, selectedCommitHash: hash }));
    if (hash) {
      postCommand({ type: 'getCommitDetails', hash });
    } else {
      setCommitDetail(null);
    }
  }, []);

  /**
   * Мгновенное переключение таба. Берём кэшированный снапшот графа из памяти
   * renderer'а (repoUiCache) и применяем сразу — пользователь видит новый
   * репо не дожидаясь IPC-ответа main'а. Когда main пришлёт свежий graphData,
   * setState аккуратно перепишет. Если кэша нет (первое открытие репо) —
   * обнуляем commits/layout чтобы UI не показывал "залипшую" историю чужого.
   */
  const switchRepoFast = useCallback((index: number) => {
    setState(prev => {
      if (prev.activeRepoIndex === index) return prev;
      const newPath = prev.openRepos[index]?.path;
      const cached = newPath ? repoUiCache.current.get(newPath) : undefined;
      return {
        ...prev,
        activeRepoIndex: index,
        selectedCommitHash: null,
        commits: cached?.commits ?? [],
        graphLayout: cached?.graphLayout ?? { nodes: [], maxColumns: 0, mergeLinks: [] },
      };
    });
    setCommitDetail(null);
    postCommand({ type: 'switchRepo', index });
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const [viewOverride, setViewOverride] = useState<'changes' | 'commits' | null>(null);
  const clearViewOverride = useCallback(() => setViewOverride(null), []);
  const clearPendingOpenDiff = useCallback(() => setPendingOpenDiff(null), []);
  const clearPendingOpenMergeEditor = useCallback(() => setPendingOpenMergeEditor(null), []);
  const clearRecoveryIssues = useCallback(() => setRecoveryIssues([]), []);
  const clearLastOpResult = useCallback(() => setLastOpResult(null), []);

  return {
    state, commitDetail, mergeState, error, selectCommit, clearError,
    viewOverride, clearViewOverride,
    rebaseProgress,
    recoveryIssues, clearRecoveryIssues,
    pendingOpenDiff, clearPendingOpenDiff,
    pendingOpenMergeEditor, clearPendingOpenMergeEditor,
    lastOpResult, clearLastOpResult,
    switchRepoFast,
  };
}
