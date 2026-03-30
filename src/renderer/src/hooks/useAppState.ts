import { useState, useEffect, useCallback } from 'react';
import type { AppState, CommitDetail, MergeState, MainEvent } from '../types';
import { sendReady, postCommand, onMainEvent, onMenuAction } from '../api';
import { setLang } from '../i18n';

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
          setCommitDetail(msg.data);
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
        case 'error':
          setError(msg.message);
          break;
      }
    });

    const unsubMenu = onMenuAction((action) => {
      switch (action) {
        case 'fetch': postCommand({ type: 'fetch' }); break;
        case 'pull': postCommand({ type: 'pull' }); break;
        case 'push': postCommand({ type: 'push' }); break;
        case 'stash': postCommand({ type: 'stash' }); break;
        case 'stashPop': postCommand({ type: 'stashPop' }); break;
      }
    });

    sendReady();
    return () => { unsubscribe(); unsubMenu(); };
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

  return { state, commitDetail, mergeState, error, selectCommit, clearError, viewOverride, clearViewOverride };
}
