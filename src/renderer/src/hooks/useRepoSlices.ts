import { useState, useCallback, useRef, type MutableRefObject } from 'react';
import type { AppState } from '../types';

/**
 * Per-repo срез состояния. Renderer хранит независимые срезы для каждого
 * открытого репо в `slices: Map<repoPath, RepoSlice>`. На свитче вкладки
 * UI мгновенно показывает срез нового репо (либо пустой, если кэш ещё не
 * наполнен), без «подмигивания» данными предыдущего. Главное преимущество:
 * `Sidebar`/`BranchStatus`/`Toolbar` и пр. перестают читать чужие
 * branches/staged/ahead до прихода `stateUpdate` от main.
 */
export type RepoSlice = Pick<
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
export type Meta = Pick<AppState, 'openRepos' | 'activeRepoIndex'>;

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

export const EMPTY_SLICE: RepoSlice = {
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

export function pickSliceFields(data: Partial<AppState>): Partial<RepoSlice> {
  const out: Partial<RepoSlice> = {};
  for (const key of SLICE_KEYS) {
    if (key in data) (out as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
  }
  return out;
}

export function pickMetaFields(data: Partial<AppState>): Partial<Meta> {
  const out: Partial<Meta> = {};
  for (const key of META_KEYS) {
    if (key in data) (out as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
  }
  return out;
}

export interface RepoSlicesApi {
  slices: Map<string, RepoSlice>;
  meta: Meta;
  /** Свежая карта слайсов БЕЗ ре-подписки потребителя (для closure-захваченных listener'ов). */
  slicesRef: MutableRefObject<Map<string, RepoSlice>>;
  /**
   * Активный repoPath по последнему meta. Используется для роутинга
   * stateUpdate без явного repoPath (например при ранних событиях).
   */
  lastRoutedRepoPathRef: MutableRefObject<string | null>;
  updateSlice(repoPath: string, patch: Partial<RepoSlice>): void;
  replaceSlice(repoPath: string, slice: RepoSlice): void;
  removeSlice(repoPath: string): void;
  applyMetaPatch(patch: Partial<Meta>): void;
  setActiveRepoIndex(index: number): boolean;
}

/**
 * Хранилище renderer-side: per-repo срезы + meta. Целенаправленно ничего
 * не знает про IPC, runningOps и transient state — только Map+state+helpers.
 */
export function useRepoSlices(): RepoSlicesApi {
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [slices, setSlices] = useState<Map<string, RepoSlice>>(() => new Map());

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

  const removeSlice = useCallback((repoPath: string): void => {
    setSlices(prev => {
      if (!prev.has(repoPath)) return prev;
      const out = new Map(prev);
      out.delete(repoPath);
      return out;
    });
  }, []);

  const applyMetaPatch = useCallback((patch: Partial<Meta>): void => {
    if (!patch || Object.keys(patch).length === 0) return;
    setMeta(prev => ({ ...prev, ...patch }));
  }, []);

  /** true если индекс реально изменился (и meta была обновлена). */
  const setActiveRepoIndex = useCallback((index: number): boolean => {
    let changed = false;
    setMeta(prev => {
      if (prev.activeRepoIndex === index) return prev;
      changed = true;
      return { ...prev, activeRepoIndex: index };
    });
    return changed;
  }, []);

  return {
    slices,
    meta,
    slicesRef,
    lastRoutedRepoPathRef,
    updateSlice,
    replaceSlice,
    removeSlice,
    applyMetaPatch,
    setActiveRepoIndex,
  };
}
