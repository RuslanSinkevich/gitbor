export interface JournalEntry {
  id: string;
  operation: string;
  startedAt: number;
  status: 'started' | 'completed' | 'failed';
  savedState: SavedState;
  params: Record<string, string>;
  completedAt?: number;
  error?: string;
}

export interface SavedState {
  readonly headHash: string;
  readonly branchName: string;
  readonly hasUncommitted: boolean;
  readonly autoStashHash?: string;
}

export interface RecoveryReport {
  readonly hasIssues: boolean;
  readonly issues: readonly RecoveryIssue[];
}

export interface RecoveryIssue {
  readonly type:
    | 'interrupted_operation'
    | 'lock_file'
    | 'unfinished_merge'
    | 'unfinished_rebase'
    | 'orphaned_auto_stash';
  readonly description: string;
  readonly journalEntry?: JournalEntry;
  readonly suggestedAction: RecoveryAction;
}

export type RecoveryAction =
  | { type: 'rollback'; journalEntryId: string }
  | { type: 'continue_merge' }
  | { type: 'abort_merge' }
  | { type: 'continue_rebase' }
  | { type: 'abort_rebase' }
  | { type: 'remove_lock' }
  | { type: 'restore_stash'; stashHash: string }
  | { type: 'ignore' };

export interface JournalFile {
  version: number;
  entries: JournalEntry[];
}
