import type { ErrorSeverity } from '../../errors/severity';

/**
 * Классы git-ошибок для дифференцированной обработки в SafetyNet/UI.
 *
 * - `conflict` — нормальный исход merge/rebase/cherry-pick: UI открывает
 *   merge editor, бэкенд НЕ делает rollback.
 * - `lock_held` — параллельный git-процесс держит `.git/index.lock`.
 *   Юзер решает: ждать / убить процесс / удалить lock.
 * - `dirty_tree` — локальные изменения перекрываются операцией.
 *   Юзер решает: stash / discard / commit.
 * - `*_in_progress` — есть незавершённое состояние (MERGE_HEAD, rebase-apply
 *   и т.п.). Юзер решает: continue / abort.
 * - `network` / `auth` — транзитные ошибки, можно повторить.
 * - `non_fast_forward` / `untracked_overwrite` — конкретные классы для
 *   push/checkout с точечными подсказками.
 * - `preflight_blocked` — операция не стартовала, pre-flight нашёл блокер.
 * - `unmerged_paths` — в индексе есть UU-файлы; любой destructive op
 *   запрещён до резолва.
 * - `unknown` — пар-фолбэк, когда классификатор не распознал stderr.
 */
export type GitErrorClass =
  | 'lock_held'
  | 'conflict'
  | 'dirty_tree'
  | 'merge_in_progress'
  | 'rebase_in_progress'
  | 'cherry_pick_in_progress'
  | 'revert_in_progress'
  | 'unmerged_paths'
  | 'network'
  | 'auth'
  | 'non_fast_forward'
  | 'untracked_overwrite'
  | 'preflight_blocked'
  | 'hook_failed'
  | 'gpg_failed'
  | 'disk_full'
  | 'repo_corrupt'
  | 'branch_unmerged'
  | 'tag_not_found'
  | 'branch_not_found'
  | 'stash_empty'
  | 'proxy_tls'
  | 'unknown';

export interface ClassifiedError {
  class: GitErrorClass;
  /** Восстановимый — есть путь решения через UI (retry / разрешить конфликт / kill процесса). */
  recoverable: boolean;
  hint?: string;
  rawStderr: string;
  severity: ErrorSeverity;
  /** Полный вывод хука (если class === hook_failed). */
  hookOutput?: string;
}

export interface GitProcessInfo {
  pid: number;
  command: string;
  cwd?: string;
}

/** Действия, которые UI может предложить юзеру по итогу OperationFailure. */
export type SuggestedAction =
  | { kind: 'retry'; label?: string; payload?: Record<string, string> }
  | { kind: 'restore_stash'; label?: string; payload: { stashHash: string } }
  | { kind: 'apply_stash_only'; label?: string; payload: { stashHash: string } }
  | { kind: 'drop_stash'; label?: string; payload: { stashHash: string } }
  | { kind: 'kill_git_process'; label?: string; payload: { pid: string } }
  | { kind: 'remove_lock'; label?: string; payload?: Record<string, string> }
  | { kind: 'rollback'; label?: string; payload: { journalEntryId: string } }
  | { kind: 'abort_merge'; label?: string; payload?: Record<string, string> }
  | { kind: 'continue_merge'; label?: string; payload?: Record<string, string> }
  | { kind: 'abort_rebase'; label?: string; payload?: Record<string, string> }
  | { kind: 'manual_continue'; label?: string; payload?: Record<string, string> }
  | { kind: 'ignore'; label?: string; payload?: Record<string, string> }
  | { kind: 'cancel'; label?: string; payload?: Record<string, string> };

export interface SavedOperationState {
  headHash: string;
  branchName: string;
  autoStashHash?: string;
}

export interface OperationFailure {
  success: false;
  errorClass: GitErrorClass;
  error: string;
  savedState?: SavedOperationState;
  suggestedActions: SuggestedAction[];
  preflightIssues?: PreflightIssue[];
  /** Идентификатор журнала операции — нужен для rollback action. */
  journalEntryId?: string;
}

export type PreflightIssueKind =
  | 'lock_held_fresh'
  | 'lock_stale'
  | 'merge_in_progress'
  | 'rebase_in_progress'
  | 'cherry_pick_in_progress'
  | 'revert_in_progress'
  | 'bisect_in_progress'
  | 'dirty_tree'
  | 'unmerged_paths'
  | 'unknown_state';

export interface PreflightIssue {
  kind: PreflightIssueKind;
  description: string;
  /** Можем починить молча (например, stale lock ≥15с). UI обычно не показывает таких. */
  autoFixable: boolean;
  gitProcesses?: GitProcessInfo[];
  /** Список путей: UU-файлы, dirty-файлы, и т.п. */
  paths?: string[];
}

export interface PreflightReport {
  ok: boolean;
  issues: PreflightIssue[];
}
