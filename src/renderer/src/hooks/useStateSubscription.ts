import { useEffect, useRef, type MutableRefObject } from 'react';
import type {
  CommitDetail,
  ErrorSeverity,
  GitErrorClass,
  MergeState,
  MainEvent,
  OperationSource,
  PreflightIssue,
  RebaseProgress,
  RecoveryIssue,
  SavedOperationState,
  SuggestedAction,
} from '../types';
import { sendReady, onMainEvent } from '../api';
import { setLang, t, tpl } from '../i18n';
import {
  pickMetaFields,
  pickSliceFields,
  type Meta,
  type RepoSlice,
} from './useRepoSlices';

export interface OpenDiffEvent { file: string; hash: string }
export interface OpenMergeEditorEvent { file: string }

/**
 * Перевести error-event с локализационным кодом. Код — точечный путь
 * по `t()` (например `repoErrors.notARepo`). Если код не нашли —
 * вернём пришедшее `message` как есть (фолбэк main).
 */
function translateError(code: string | undefined, data: Record<string, string> | undefined, fallback: string): string {
  if (!code) return fallback;
  const parts = code.split('.');
  let node: unknown = t();
  for (const p of parts) {
    if (node && typeof node === 'object' && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return fallback;
    }
  }
  if (typeof node !== 'string') return fallback;
  return data ? tpl(node, data) : node;
}

export interface StateSubscriptionDeps {
  // slices / meta
  applyMetaPatch(patch: Partial<Meta>): void;
  replaceSlice(repoPath: string, slice: RepoSlice): void;
  updateSlice(repoPath: string, patch: Partial<RepoSlice>): void;
  removeSlice(repoPath: string): void;
  slicesRef: MutableRefObject<Map<string, RepoSlice>>;
  lastRoutedRepoPathRef: MutableRefObject<string | null>;
  // running ops
  startOperation(repoPath: string | null | undefined, operation: string): void;
  endOperation(
    repoPath: string | null | undefined,
    operation: string,
    success: boolean,
    error?: string,
    extras?: {
      errorClass?: GitErrorClass;
      savedState?: SavedOperationState;
      suggestedActions?: SuggestedAction[];
      preflightIssues?: PreflightIssue[];
      journalEntryId?: string;
      severity?: ErrorSeverity;
      source?: OperationSource;
      hookOutput?: string;
    },
  ): void;
  removeRunningOpsByRepo(repoPath: string): void;
  // transient
  setCommitDetail(updater: (prev: CommitDetail | null) => CommitDetail | null): void;
  setMergeState(value: MergeState | null): void;
  setError(value: string | null): void;
  setRebaseProgress(value: RebaseProgress | null): void;
  setRecoveryIssues(value: readonly RecoveryIssue[]): void;
  setPendingOpenDiff(value: OpenDiffEvent | null): void;
  setPendingOpenMergeEditor(value: OpenMergeEditorEvent | null): void;
  setViewOverride(value: 'changes' | 'commits' | null): void;
  /**
   * Сбросить «висящий» transient state когда закрыли активный репо.
   * Вызывается из обработчика `repoClosed` если закрытый путь совпадает
   * с `lastRoutedRepoPathRef.current`.
   */
  resetActiveTransient(): void;
}

/**
 * Единственный потребитель `onMainEvent` в renderer-state. Принимает
 * dispatcher-объект и роутит каждый MainEvent.type в соответствующий
 * setter из useRepoSlices/useRunningOps/transient state фасада.
 *
 * ВАЖНО: подписка делается ОДИН раз (deps стабильные refs/callbacks).
 * Дублировать `onMainEvent` нельзя — listener'ы складываются глобально.
 */
export function useStateSubscription(deps: StateSubscriptionDeps): void {
  // Стабильный ref на текущий dispatcher: useEffect создаётся один раз,
  // но handler'ы внутри нужны свежие на каждый event без ре-подписки.
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const unsubscribe = onMainEvent((msg: MainEvent) => {
      const d = depsRef.current;
      switch (msg.type) {
        case 'fullState': {
          const data = msg.data;
          const metaPatch = pickMetaFields(data);
          d.applyMetaPatch(metaPatch);
          if (data.repoPath) {
            d.replaceSlice(data.repoPath, {
              repoPath: data.repoPath,
              repoName: data.repoName,
              currentBranch: data.currentBranch,
              branches: data.branches,
              tags: data.tags,
              stashes: data.stashes,
              remotes: data.remotes,
              stagedFiles: data.stagedFiles,
              unstagedFiles: data.unstagedFiles,
              conflicts: data.conflicts,
              ahead: data.ahead,
              behind: data.behind,
              commits: data.commits,
              graphLayout: data.graphLayout,
              selectedCommitHash: data.selectedCommitHash,
            });
          }
          break;
        }
        case 'stateUpdate': {
          const data = msg.data;
          const metaPatch = pickMetaFields(data);
          if (Object.keys(metaPatch).length > 0) {
            d.applyMetaPatch(metaPatch);
          }
          // Маршрутизируем slice-поля в срез по repoPath. Если repoPath
          // пустой (state очищен) — ничего не пишем; UI просто покажет
          // EMPTY_SLICE для текущего активного индекса.
          const targetRepoPath = data.repoPath ?? d.lastRoutedRepoPathRef.current ?? null;
          if (targetRepoPath) {
            const slicePatch = pickSliceFields(data);
            if (Object.keys(slicePatch).length > 0) {
              d.updateSlice(targetRepoPath, slicePatch);
            }
          }
          break;
        }
        case 'commitDetails':
          d.setCommitDetail(prev => {
            const activeRepoPath = d.lastRoutedRepoPathRef.current;
            if (!activeRepoPath) return prev;
            const sliceSelected = d.slicesRef.current.get(activeRepoPath)?.selectedCommitHash;
            if (sliceSelected && (msg.hash === sliceSelected || msg.data.hash === sliceSelected)) {
              return msg.data;
            }
            return prev;
          });
          break;
        case 'commitDiff': {
          const { fromHash, toHash, files } = msg.data;
          const rangeHash = `${fromHash}..${toHash}`;
          d.setCommitDetail(() => ({
            hash: rangeHash,
            parents: [],
            authorName: '',
            authorEmail: '',
            authorDate: 0,
            committerName: '',
            committerEmail: '',
            commitDate: 0,
            refs: [],
            subject: `${fromHash.substring(0, 7)}..${toHash.substring(0, 7)}`,
            body: '',
            files,
          }));
          break;
        }
        case 'graphData': {
          const repoPath = msg.repoPath;
          if (!repoPath) break;
          d.updateSlice(repoPath, {
            commits: msg.data.commits,
            graphLayout: msg.data.layout,
          });
          break;
        }
        case 'operationStart': {
          d.startOperation(msg.repoPath, msg.operation);
          break;
        }
        case 'operationEnd': {
          d.endOperation(msg.repoPath, msg.operation, msg.success, msg.error, {
            errorClass: msg.errorClass,
            savedState: msg.savedState,
            suggestedActions: msg.suggestedActions,
            preflightIssues: msg.preflightIssues,
            journalEntryId: msg.journalEntryId,
            severity: msg.severity,
            source: msg.source,
            hookOutput: msg.hookOutput,
          });
          break;
        }
        case 'config':
          setLang(msg.lang);
          break;
        case 'mergeState':
          d.setMergeState(msg.data);
          break;
        case 'mergeCompleted':
        case 'mergeAborted':
          d.setMergeState(null);
          break;
        case 'showView':
          d.setViewOverride(msg.view);
          break;
        case 'rebaseProgress':
          d.setRebaseProgress(msg.data);
          break;
        case 'recoveryRequired':
          d.setRecoveryIssues(msg.issues);
          break;
        case 'openDiff':
          d.setPendingOpenDiff({ file: msg.file, hash: msg.hash });
          break;
        case 'openMergeEditor':
          d.setPendingOpenMergeEditor({ file: msg.file });
          break;
        case 'repoClosed': {
          d.removeSlice(msg.path);
          // Если репо закрыли с активной операцией (зависший pull, например),
          // running-флаг иначе остался бы в карте навечно.
          d.removeRunningOpsByRepo(msg.path);
          // Если закрыли активный репо — чистим все висящие transient state-ы,
          // иначе в UI остаются commitDetail/mergeState/diff от закрытого
          // контекста (юзер видит «Выберите коммит», но справа всё ещё diff).
          if (msg.path === d.lastRoutedRepoPathRef.current) {
            d.resetActiveTransient();
          }
          break;
        }
        case 'error':
          d.setError(translateError(msg.code, msg.data, msg.message));
          break;
      }
    });

    sendReady();
    return () => { unsubscribe(); };
  }, []);
}
