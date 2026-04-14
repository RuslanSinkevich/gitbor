import { useState, useEffect, useCallback } from 'react';
import type { AppState, CommitDetail, MergeState, MainEvent, RebaseProgress, RecoveryIssue } from '../types';
import { sendReady, postCommand, onMainEvent } from '../api';
import { setLang } from '../i18n';

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
        case 'graphData':
          setState(prev => ({
            ...prev,
            commits: msg.data.commits,
            graphLayout: msg.data.layout,
          }));
          break;
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
          if (!msg.success && msg.error) {
            setError(msg.error);
          }
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
  };
}
