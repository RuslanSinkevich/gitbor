import { createHash } from 'crypto';
import type { AppState } from '../git/types';

/**
 * Per-repo срез (ветки, статус, граф). Живёт в `StateManager.slicesByRepo`.
 */
export interface RepoSlice {
  currentBranch: string;
  branches: AppState['branches'];
  tags: AppState['tags'];
  stashes: AppState['stashes'];
  remotes: AppState['remotes'];
  stagedFiles: AppState['stagedFiles'];
  unstagedFiles: AppState['unstagedFiles'];
  conflicts: AppState['conflicts'];
  ahead: number;
  behind: number;
  commits: AppState['commits'];
  graphLayout: AppState['graphLayout'];
  selectedCommitHash: string | null;
  cachedHeadHash: string | null;
  cachedLogHash: string | null;
  cachedLogLimit: number;
  token: number;
}

export function emptyRepoSlice(): RepoSlice {
  return {
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
    cachedHeadHash: null,
    cachedLogHash: null,
    cachedLogLimit: 0,
    token: 0,
  };
}

/** Зеркалирование slice → поля репо в `AppState` (без openRepos / running). */
export function mirrorRepoSliceToAppState(state: AppState, slice: RepoSlice): void {
  state.currentBranch = slice.currentBranch;
  state.branches = slice.branches;
  state.tags = slice.tags;
  state.stashes = slice.stashes;
  state.remotes = slice.remotes;
  state.stagedFiles = slice.stagedFiles;
  state.unstagedFiles = slice.unstagedFiles;
  state.conflicts = slice.conflicts;
  state.ahead = slice.ahead;
  state.behind = slice.behind;
  state.commits = slice.commits;
  state.graphLayout = slice.graphLayout;
  state.selectedCommitHash = slice.selectedCommitHash;
}

export const GIT_LOG_FORMAT =
  '%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s%x00%G?';
export const GIT_REF_FORMAT =
  '%(refname:short)%00%(objectname)%00%(upstream:short)%00%(HEAD)%00%(upstream:track)';
export const GIT_TAG_REF_FORMAT =
  '%(refname:short)%00%(objectname)';
export const GIT_STASH_FORMAT =
  '%gd%x00%H%x00%gs%x00%P';

/** MD5-хэш для дедупликации `git log` stdout. */
export function hashGitStdout(s: string): string {
  return createHash('md5').update(s).digest('hex');
}
