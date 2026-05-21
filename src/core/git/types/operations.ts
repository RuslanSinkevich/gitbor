import type {
  GitErrorClass,
  SavedOperationState,
  SuggestedAction,
  PreflightIssue,
} from './errors';

export interface MergeResult {
  success: boolean;
  conflicts: string[];
}

export interface OperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  rollbackAvailable: boolean;
  /**
   * Новые поля для дифференциированной обработки ошибок в UI.
   * SafetyNet заполняет их когда операция упала; легаси-вызовы получают
   * `undefined` — старое поведение сохраняется (toast по `error`).
   */
  errorClass?: GitErrorClass;
  savedState?: SavedOperationState;
  suggestedActions?: SuggestedAction[];
  preflightIssues?: PreflightIssue[];
  journalEntryId?: string;
}

export interface GitExecOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string>;
  stdin?: string;
}

export interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

export interface MergeOptions {
  noCommit: boolean;
  squash: boolean;
  ffOnly: boolean;
  noFf?: boolean;
}

export interface ConflictFile {
  path: string;
  status: 'conflicted' | 'resolved' | 'staged';
  oursModified: boolean;
  theirsModified: boolean;
}

export type ConflictResolutionKind =
  | 'merge'
  | 'cherry-pick'
  | 'revert'
  | 'rebase'
  | 'unmerged-paths'
  | 'none';

export interface MergeState {
  inProgress: boolean;
  sourceBranch: string;
  targetBranch: string;
  totalConflicts: number;
  resolvedConflicts: number;
  conflictFiles: ConflictFile[];
  /**
   * Что именно происходит. `merge` — классический merge с MERGE_HEAD;
   * `cherry-pick`/`revert`/`rebase` — соответствующие state-файлы;
   * `unmerged-paths` — UU-файлы без любых state-файлов (повреждённое
   * состояние, ручной reset). UI меняет заголовок баннера по kind.
   */
  kind: ConflictResolutionKind;
}

export type ConflictResolution = 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first';

export interface ConflictBlock {
  type: 'clean' | 'conflict';
  content: string;
  ours: string;
  theirs: string;
}

export interface ConflictContent {
  file: string;
  blocks: ConflictBlock[];
  hasConflicts: boolean;
}
