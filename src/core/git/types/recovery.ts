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
  | { type: 'ignore' };

export interface JournalFile {
  version: number;
  entries: JournalEntry[];
}
