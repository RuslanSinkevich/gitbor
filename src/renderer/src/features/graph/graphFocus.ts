import type { Branch, Commit } from '@core/git/types';

/**
 * Автофокус графа после write-операций: решение «куда встать» вынесено из
 * App.tsx, чтобы правила покрывались тестами без рендера.
 *
 * Имена операций — те, что приходят в `operationEnd.operation` из
 * `op('<name>', …)` в `handlersGitOps.ts` / `handlersRepoExtras.ts`.
 */

/** Операции, после которых граф встаёт на tip (HEAD или явная ветка). */
export const GRAPH_FOCUS_OPS: ReadonlySet<string> = new Set([
  'commit', 'push', 'pull', 'checkout', 'fetchBranch',
  'merge', 'cherry-pick', 'revert', 'rebase', 'reset', 'restoreReflog',
  'createBranch',
]);

/**
 * Операции, у которых tip уже лежит в текущем `commits[]`: ждать нового
 * массива нельзя — он может не прийти вообще (checkout/createBranch историю
 * не меняют, fetchBranch двигает уже загруженную ветку).
 */
export const GRAPH_FOCUS_NO_WAIT: ReadonlySet<string> = new Set([
  'checkout', 'fetchBranch', 'createBranch',
]);

/** Полный и сокращённый SHA считаем одним коммитом. */
export function hashesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function shouldFocusAfterOp(operation: string | null | undefined): boolean {
  return !!operation && GRAPH_FOCUS_OPS.has(operation);
}

/**
 * Ветка, на tip которой нужно встать, когда это НЕ текущая HEAD.
 * `fetchBranch` / `createBranch` работают по чужой ветке без checkout, поэтому
 * имя берём из самой команды, а не из состояния.
 */
export function focusBranchNameForOp(
  operation: string | null | undefined,
  command: { type: string; branch?: string; name?: string } | null | undefined,
): string | undefined {
  if (!operation || !command) return undefined;
  if (operation === 'fetchBranch' && command.type === 'fetchBranch') return command.branch;
  if (operation === 'createBranch' && command.type === 'createBranch') return command.name;
  return undefined;
}

export interface PendingGraphFocus {
  /** `operationEnd.operation`; null — запрос не от операции (например, mergeCompleted). */
  operation: string | null;
  repoPath: string;
  /** `state.commits` на момент постановки запроса — маркер «граф ещё не обновился». */
  commitsAtEnd: readonly Commit[];
  branchName?: string;
  /** Не ждать нового `commits[]`, даже если операция не в GRAPH_FOCUS_NO_WAIT. */
  skipWait?: boolean;
}

export interface GraphFocusState {
  repoPath: string;
  commits: readonly Commit[];
  branches: readonly Branch[];
}

export type GraphFocusOutcome =
  /** Встать на `hash`; `branchName` задан — показать ветку в сайдбаре. */
  | { kind: 'focus'; hash: string; branchName?: string }
  /** Данных пока мало (нет ветки / tip вне графа / граф не обновился) — ждать. */
  | { kind: 'wait' }
  /** Запрос неактуален (сменили репозиторий) — выбросить. */
  | { kind: 'drop' };

export function resolveGraphFocus(
  pending: PendingGraphFocus,
  state: GraphFocusState,
): GraphFocusOutcome {
  if (pending.repoPath !== state.repoPath) return { kind: 'drop' };

  const tip = pending.branchName
    ? state.branches.find(b => !b.isRemote && b.name === pending.branchName)?.hash
    : state.branches.find(b => b.isCurrent && !b.isRemote)?.hash;
  if (!tip) return { kind: 'wait' };
  if (!state.commits.some(c => hashesMatch(c.hash, tip))) return { kind: 'wait' };

  const mustWaitForGraph = !pending.skipWait
    && !GRAPH_FOCUS_NO_WAIT.has(pending.operation ?? '');
  if (mustWaitForGraph && state.commits === pending.commitsAtEnd) return { kind: 'wait' };

  return { kind: 'focus', hash: tip, branchName: pending.branchName };
}
