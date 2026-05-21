import type { GitErrorClass } from './errors';

export interface JournalEntry {
  id: string;
  operation: string;
  startedAt: number;
  status: 'started' | 'completed' | 'failed';
  savedState: SavedState;
  params: Record<string, string>;
  completedAt?: number;
  error?: string;
  /** Класс ошибки, если status === 'failed'. Заполняется SafetyNet после classify(). */
  errorClass?: GitErrorClass;
}

export interface SavedState {
  headHash: string;
  branchName: string;
  hasUncommitted: boolean;
  autoStashHash?: string;
}

export interface RecoveryReport {
  hasIssues: boolean;
  issues: RecoveryIssue[];
}

export interface RecoveryIssue {
  type:
    | 'interrupted_operation'
    | 'lock_file'
    | 'unfinished_merge'
    | 'unfinished_rebase'
    | 'orphaned_auto_stash';
  description: string;
  journalEntry?: JournalEntry;
  suggestedAction: RecoveryAction;
}

export type RecoveryAction =
  | { type: 'rollback'; journalEntryId: string }
  | { type: 'continue_merge' }
  | { type: 'abort_merge' }
  | { type: 'continue_rebase' }
  | { type: 'abort_rebase' }
  | { type: 'remove_lock' }
  | { type: 'restore_stash'; stashHash: string }
  | { type: 'apply_stash_only'; stashHash: string }
  | { type: 'drop_stash'; stashHash: string }
  | { type: 'kill_git_process'; pid: number }
  | { type: 'retry'; journalEntryId: string }
  | { type: 'manual_continue' }
  | { type: 'ignore' };

export interface JournalFile {
  version: number;
  entries: JournalEntry[];
}
