import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { AppState, CommitDetail, MergeState, MainEvent, RebaseProgress, RecoveryIssue } from '../types';
import { sendReady, postCommand, onMainEvent } from '../api';
import { setLang, t, tpl } from '../i18n';

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

/**
 * Per-repo срез состояния. Renderer хранит независимые срезы для каждого
 * открытого репо в `slices: Map<repoPath, RepoSlice>`. На свитче вкладки
 * UI мгновенно показывает срез нового репо (либо пустой, если кэш ещё не
 * наполнен), без «подмигивания» данными предыдущего. Главное преимущество:
 * `Sidebar`/`BranchStatus`/`Toolbar` и пр. перестают читать чужие
 * branches/staged/ahead до прихода `stateUpdate` от main.
 */
type RepoSlice = Pick<
  AppState,
  | 'repoPath'
  | 'repoName'
  | 'currentBranch'
  | 'branches'
  | 'tags'
  | 'stashes'
  | 'remotes'
  | 'stagedFiles'
  | 'unstagedFiles'
  | 'conflicts'
  | 'ahead'
  | 'behind'
  | 'commits'
  | 'graphLayout'
  | 'selectedCommitHash'
>;

// `isOperationRunning`/`currentOperation` УДАЛЕНЫ из Meta: теперь это
// производные значения от `runningOpsByRepo` per-repo карты. Глобальный
// флаг блокировал кнопки на любой вкладке во время fetch/push соседнего
// репо — это и есть жалоба «впал в ожидание». Решение: каждое репо имеет
// свой статус, флаг для UI берётся от активной вкладки.
type Meta = Pick<AppState, 'openRepos' | 'activeRepoIndex'>;

const SLICE_KEYS: readonly (keyof RepoSlice)[] = [
  'repoPath',
  'repoName',
  'currentBranch',
  'branches',
  'tags',
  'stashes',
  'remotes',
  'stagedFiles',
  'unstagedFiles',
  'conflicts',
  'ahead',
  'behind',
  'commits',
  'graphLayout',
  'selectedCommitHash',
];

const META_KEYS: readonly (keyof Meta)[] = [
  'openRepos',
  'activeRepoIndex',
];

const EMPTY_SLICE: RepoSlice = {
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
};

const EMPTY_META: Meta = {
  openRepos: [],
  activeRepoIndex: 0,
};

export interface OpenDiffEvent { file: string; hash: string }
export interface OpenMergeEditorEvent { file: string }
export interface OperationResult { operation: string; success: boolean; error?: string }

function pickSliceFields(data: Partial<AppState>): Partial<RepoSlice> {
  const out: Partial<RepoSlice> = {};
  for (const key of SLICE_KEYS) {
    if (key in data) (out as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
  }
  return out;
}

function pickMetaFields(data: Partial<AppState>): Partial<Meta> {
  const out: Partial<Meta> = {};
  for (const key of META_KEYS) {
    if (key in data) (out as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
  }
  return out;
}

export function useAppState() {
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [slices, setSlices] = useState<Map<string, RepoSlice>>(() => new Map());
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebaseProgress, setRebaseProgress] = useState<RebaseProgress | null>(null);
  const [recoveryIssues, setRecoveryIssues] = useState<readonly RecoveryIssue[]>([]);
  const [pendingOpenDiff, setPendingOpenDiff] = useState<OpenDiffEvent | null>(null);
  const [pendingOpenMergeEditor, setPendingOpenMergeEditor] = useState<OpenMergeEditorEvent | null>(null);
  const [lastOpResult, setLastOpResult] = useState<OperationResult | null>(null);
  const [viewOverride, setViewOverride] = useState<'changes' | 'commits' | null>(null);
  // Per-repo карта активных операций: repoPath → operation. Используется
  // вместо глобального флага. `state.isOperationRunning` для UI берётся
  // только по активной вкладке. `null`-ключ = операция без репо
  // (clone/init до открытия результата).
  const [runningOpsByRepo, setRunningOpsByRepo] = useState<Map<string, string>>(() => new Map());

  // Активный repoPath по последнему meta (используется для роутинга stateUpdate
  // без явного repoPath, например при ранних событиях без активного репо).
  const lastRoutedRepoPathRef = useRef<string | null>(null);

  // Свежие slices без ре-подписки на onMainEvent: closure useEffect ловит
  // их только один раз, поэтому commitDetails-роуту нужен ref.
  const slicesRef = useRef<Map<string, RepoSlice>>(slices);
  slicesRef.current = slices;

  const updateSlice = useCallback((repoPath: string, patch: Partial<RepoSlice>): void => {
    if (!repoPath) return;
    lastRoutedRepoPathRef.current = repoPath;
    setSlices(prev => {
      const existing = prev.get(repoPath) ?? { ...EMPTY_SLICE, repoPath };
      const next = { ...existing, ...patch, repoPath };
      // identity-skip: ничего не поменялось — не пересоздаём Map
      let changed = false;
      for (const k of Object.keys(patch) as (keyof RepoSlice)[]) {
        if ((existing as Record<string, unknown>)[k] !== (next as Record<string, unknown>)[k]) {
          changed = true;
          break;
        }
      }
      if (!changed && prev.get(repoPath) === existing) return prev;
      const out = new Map(prev);
      out.set(repoPath, next);
      return out;
    });
  }, []);

  const replaceSlice = useCallback((repoPath: string, slice: RepoSlice): void => {
    if (!repoPath) return;
    lastRoutedRepoPathRef.current = repoPath;
    setSlices(prev => {
      const out = new Map(prev);
      out.set(repoPath, { ...slice, repoPath });
      return out;
    });
  }, []);

  useEffect(() => {
    const unsubscribe = onMainEvent((msg: MainEvent) => {
      switch (msg.type) {
        case 'fullState': {
          const data = msg.data;
          const metaPatch = pickMetaFields(data);
          setMeta(prev => ({ ...prev, ...metaPatch }));
          if (data.repoPath) {
            replaceSlice(data.repoPath, {
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
            setMeta(prev => ({ ...prev, ...metaPatch }));
          }
          // Маршрутизируем slice-поля в срез по repoPath. Если repoPath
          // пустой (state очищен) — ничего не пишем; UI просто покажет
          // EMPTY_SLICE для текущего активного индекса.
          const targetRepoPath = data.repoPath ?? lastRoutedRepoPathRef.current ?? null;
          if (targetRepoPath) {
            const slicePatch = pickSliceFields(data);
            if (Object.keys(slicePatch).length > 0) {
              updateSlice(targetRepoPath, slicePatch);
            }
          }
          break;
        }
        case 'commitDetails':
          setCommitDetail(prev => {
            const activeRepoPath = lastRoutedRepoPathRef.current;
            if (!activeRepoPath) return prev;
            const sliceSelected = slicesRef.current.get(activeRepoPath)?.selectedCommitHash;
            if (sliceSelected && (msg.hash === sliceSelected || msg.data.hash === sliceSelected)) {
              return msg.data;
            }
            return prev;
          });
          break;
        case 'graphData': {
          const repoPath = msg.repoPath;
          if (!repoPath) break;
          updateSlice(repoPath, {
            commits: msg.data.commits,
            graphLayout: msg.data.layout,
          });
          break;
        }
        case 'operationStart': {
          const key = msg.repoPath ?? '';
          setRunningOpsByRepo(prev => {
            const next = new Map(prev);
            next.set(key, msg.operation);
            return next;
          });
          break;
        }
        case 'operationEnd': {
          const key = msg.repoPath ?? '';
          setRunningOpsByRepo(prev => {
            if (!prev.has(key)) return prev;
            const next = new Map(prev);
            next.delete(key);
            return next;
          });
          setLastOpResult({ operation: msg.operation, success: msg.success, error: msg.error });
          break;
        }
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
          setSlices(prev => {
            if (!prev.has(msg.path)) return prev;
            const out = new Map(prev);
            out.delete(msg.path);
            return out;
          });
          // Если репо закрыли с активной операцией (зависший pull, например),
          // running-флаг иначе остался бы в карте навечно.
          setRunningOpsByRepo(prev => {
            if (!prev.has(msg.path)) return prev;
            const out = new Map(prev);
            out.delete(msg.path);
            return out;
          });
          break;
        case 'error':
          setError(translateError(msg.code, msg.data, msg.message));
          break;
      }
    });

    sendReady();
    return () => { unsubscribe(); };
  }, [updateSlice, replaceSlice]);

  // Производный AppState — единый view по активному срезу + meta. Если
  // активный repo ещё не имеет среза (только что открыт) — показываем EMPTY_SLICE.
  // `isOperationRunning`/`currentOperation` берутся ИСКЛЮЧИТЕЛЬНО от
  // активной вкладки: соседние fetch/push не должны блокировать кнопки тут.
  const state: AppState = useMemo(() => {
    const activeRepo = meta.openRepos[meta.activeRepoIndex];
    const slice = activeRepo ? slices.get(activeRepo.path) : undefined;
    const base = slice ?? EMPTY_SLICE;
    const activePath = activeRepo?.path ?? '';
    const currentOp = activePath ? runningOpsByRepo.get(activePath) ?? null : null;
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
  }, [meta, slices, runningOpsByRepo]);

  const selectCommit = useCallback((hash: string | null) => {
    const activeRepoPath = state.repoPath;
    if (activeRepoPath) {
      updateSlice(activeRepoPath, { selectedCommitHash: hash });
    }
    if (hash) {
      postCommand({ type: 'getCommitDetails', hash });
    } else {
      setCommitDetail(null);
    }
  }, [state.repoPath, updateSlice]);

  /**
   * Мгновенное переключение таба. Только меняем `activeRepoIndex` — UI
   * перерисуется на срез нового репо. Если среза нет (первое открытие) —
   * EMPTY_SLICE; данные подтянутся событиями от main. Никаких полей чужого
   * репо в state в момент клика быть не может.
   */
  const switchRepoFast = useCallback((index: number) => {
    setMeta(prev => {
      if (prev.activeRepoIndex === index) return prev;
      return { ...prev, activeRepoIndex: index };
    });
    setCommitDetail(null);
    postCommand({ type: 'switchRepo', index });
  }, []);

  const clearError = useCallback(() => setError(null), []);
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
