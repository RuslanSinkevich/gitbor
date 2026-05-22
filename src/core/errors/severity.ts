import type { GitErrorClass } from '../git/types';

export type OperationSource = 'user' | 'background' | 'auto-retry';
export type ErrorSeverity = 'critical' | 'warning' | 'info';

/** Дефолтный severity по классу ошибки (без учёта source). */
export function classToSeverity(errorClass: GitErrorClass): ErrorSeverity {
  switch (errorClass) {
    case 'conflict':
    case 'dirty_tree':
    case 'untracked_overwrite':
    case 'merge_in_progress':
    case 'rebase_in_progress':
    case 'cherry_pick_in_progress':
    case 'revert_in_progress':
    case 'unmerged_paths':
    case 'non_fast_forward':
    case 'lock_held':
    case 'auth':
    case 'preflight_blocked':
    case 'hook_failed':
    case 'gpg_failed':
    case 'branch_unmerged':
    case 'proxy_tls':
      return 'warning';
    case 'network':
    case 'tag_not_found':
    case 'branch_not_found':
    case 'stash_empty':
      return 'info';
    case 'disk_full':
    case 'repo_corrupt':
    case 'unknown':
      return 'critical';
    default:
      return 'critical';
  }
}

export function normalizeSource(source?: OperationSource): OperationSource {
  return source ?? 'user';
}

/** SafetyDialog по центру — только user + critical. */
export function shouldShowSafetyModal(source: OperationSource | undefined, severity: ErrorSeverity): boolean {
  return normalizeSource(source) === 'user' && severity === 'critical';
}

export type ToastLevel = 'success' | 'info' | 'warning' | 'error';

/**
 * Матрица показа toast: null = не показывать (только журнал).
 * @see docs/tasks/error-severity-system.md
 */
export function resolveToastLevel(
  source: OperationSource | undefined,
  severity: ErrorSeverity,
): ToastLevel | null {
  const src = normalizeSource(source);
  if (src === 'background') {
    if (severity === 'info') return null;
    if (severity === 'warning') return 'info';
    return 'warning';
  }
  if (src === 'auto-retry') {
    if (severity === 'critical') return 'warning';
    return null;
  }
  // user
  if (severity === 'info') return 'info';
  if (severity === 'warning') return 'warning';
  return 'error';
}

/** Хост из stderr для агрегации network/auth toast'ов. */
export function extractErrorHost(stderr: string): string | null {
  const m = stderr.match(/https?:\/\/([^/\s#?]+)/i)
    ?? stderr.match(/git@([^:\s]+)/i);
  return m?.[1] ?? null;
}
