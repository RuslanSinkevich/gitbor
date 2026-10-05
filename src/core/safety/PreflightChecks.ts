import { existsSync, statSync } from 'fs';
import { join } from 'path';
import type { GitExecutor } from '../git/GitExecutor';
import type { PreflightIssue, PreflightReport } from '../git/types';
import { findGitProcesses } from './GitProcessDetector';
import { mainLogger } from '../utils/Logger';
import {
  waitForLockRelease,
  tryRemoveStaleLock,
  type LockWaiterOptions,
} from './LockWaiter';
import { resolveGitDir } from '../git/gitDir';

/**
 * Pre-flight проверки ПЕРЕД destructive операцией. Цель: не входить
 * в `wrapDestructive`, если репо в состоянии, где операция точно
 * упадёт (или может упасть по транзитной причине).
 *
 * Контракт:
 *   - `ok=true` — все блокеры разрешены (stale-lock удалён молча,
 *     state-файлов нет, UU нет);
 *   - `ok=false` — есть `issues[]`, юзер должен решить через SafetyDialog;
 *   - проверки read-only, кроме автоудаления stale `index.lock`.
 *
 * Стратегия для lock:
 *   1. `LockWaiter` ждёт освобождения exponential-backoff (≈3.1с) — это
 *      Fork-стиль: типичный git-вызов укладывается, диалог не нужен.
 *   2. Если waiter не дождался, но lock не двинулся и старше staleAgeMs —
 *      удаляем молча (stale).
 *   3. Иначе — issue 'lock_held_fresh' + git-процессы в payload.
 */
export const STALE_LOCK_AGE_MS = 15_000;

export interface PreflightOptions {
  /** Проверять dirty-tree (для checkout/rebase). Большинство destructive ops это терпят. */
  checkDirtyTree?: boolean;
  /** Не удалять stale lock автоматически (для тестов). */
  noAutoRemoveStaleLock?: boolean;
  /** Подменить параметры lock-waiter (для тестов: `delays: []`). */
  lockWaiter?: LockWaiterOptions;
}

/** Операции, для которых наличие MERGE_HEAD — критический блок. */
const MERGE_BLOCKING_OPS = new Set(['merge', 'pull', 'rebase', 'cherry-pick', 'revert', 'checkout']);
/**
 * Операции, которые в принципе несовместимы с dirty tree. `checkout`
 * сюда не входит: UI открывает CheckoutDialog (keep/stash/discard) и
 * сам решает, что делать с локальными изменениями. Если же checkout
 * вызывает другую часть пайплайна без UI — git сам вернёт ошибку,
 * классификатор её распознает и SafetyDialog отработает по обычной схеме.
 */
const DIRTY_BLOCKING_OPS = new Set(['rebase']);

/**
 * Кэш per-repo на 500мс — гасит дубли preflight'а при быстрых
 * повторных кликах (двойной checkout, repeat fetch). Кэшируем только
 * ok=true: ok=false должен пересчитываться, иначе застрянем в
 * "lock_held_fresh" даже после того как процесс завершился.
 */
interface CacheEntry {
  time: number;
  report: PreflightReport;
}
const PREFLIGHT_CACHE_MS = 500;

export class PreflightChecks {
  private static readonly okCache = new Map<string, CacheEntry>();

  constructor(private readonly git: GitExecutor) {}

  async check(
    repoPath: string,
    operation: string,
    opts: PreflightOptions = {},
  ): Promise<PreflightReport> {
    const cacheKey = `${repoPath}|${operation}|${opts.checkDirtyTree ? 1 : 0}`;
    const cached = PreflightChecks.okCache.get(cacheKey);
    if (cached && Date.now() - cached.time < PREFLIGHT_CACHE_MS) {
      return cached.report;
    }

    const issues: PreflightIssue[] = [];
    const gitDir = resolveGitDir(repoPath);

    await this.checkLock(gitDir, repoPath, issues, opts);
    await this.checkStateFiles(gitDir, operation, issues);

    const dirtyAlso = opts.checkDirtyTree || DIRTY_BLOCKING_OPS.has(operation);
    const parallelChecks: Promise<void>[] = [this.checkUnmergedPaths(operation, issues)];
    if (dirtyAlso) parallelChecks.push(this.checkDirtyTree(issues));
    await Promise.all(parallelChecks);

    const report: PreflightReport = { ok: issues.length === 0, issues };
    if (report.ok) {
      PreflightChecks.okCache.set(cacheKey, { time: Date.now(), report });
    } else {
      PreflightChecks.okCache.delete(cacheKey);
    }
    return report;
  }

  /** Инвалидировать кэш per-repo (после write-операций). */
  static invalidateCache(repoPath?: string): void {
    if (!repoPath) {
      PreflightChecks.okCache.clear();
      return;
    }
    for (const key of PreflightChecks.okCache.keys()) {
      if (key.startsWith(`${repoPath}|`)) PreflightChecks.okCache.delete(key);
    }
  }

  private async checkLock(
    gitDir: string,
    repoPath: string,
    issues: PreflightIssue[],
    opts: PreflightOptions,
  ): Promise<void> {
    const lockPath = join(gitDir, 'index.lock');
    if (!existsSync(lockPath)) return;

    let initialAgeMs: number;
    try {
      initialAgeMs = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      return;
    }

    if (initialAgeMs >= STALE_LOCK_AGE_MS && !opts.noAutoRemoveStaleLock) {
      if (tryRemoveStaleLock(lockPath)) return;
      issues.push({
        kind: 'lock_stale',
        description: `Stale .git/index.lock (age ${Math.round(initialAgeMs / 1000)}s) — cannot remove.`,
        autoFixable: true,
      });
      return;
    }

    const waiter = await waitForLockRelease(lockPath, opts.lockWaiter);
    if (waiter.released) {
      mainLogger.debug(`preflight: lock released after ${waiter.waitedMs}ms wait`);
      return;
    }

    if (waiter.staleSuspect && !opts.noAutoRemoveStaleLock) {
      mainLogger.info(
        `preflight: lock did not move during ${waiter.waitedMs}ms wait and age ${Math.round((waiter.finalAgeMs ?? 0) / 1000)}s — treating as stale`,
      );
      if (tryRemoveStaleLock(lockPath)) return;
    }

    const procs = await findGitProcesses(repoPath).catch(() => []);
    issues.push({
      kind: 'lock_held_fresh',
      description: `Another git process is holding .git/index.lock (age ${Math.round((waiter.finalAgeMs ?? initialAgeMs) / 1000)}s, waited ${waiter.waitedMs}ms).`,
      autoFixable: false,
      gitProcesses: procs.length > 0 ? procs : undefined,
    });
  }

  private async checkStateFiles(
    gitDir: string,
    operation: string,
    issues: PreflightIssue[],
  ): Promise<void> {
    const checks: Array<{ file: string; kind: PreflightIssue['kind']; desc: string }> = [
      { file: 'MERGE_HEAD', kind: 'merge_in_progress', desc: 'A merge is in progress (MERGE_HEAD exists).' },
      { file: 'rebase-apply', kind: 'rebase_in_progress', desc: 'A rebase is in progress (rebase-apply).' },
      { file: 'rebase-merge', kind: 'rebase_in_progress', desc: 'A rebase is in progress (rebase-merge).' },
      { file: 'CHERRY_PICK_HEAD', kind: 'cherry_pick_in_progress', desc: 'A cherry-pick is in progress.' },
      { file: 'REVERT_HEAD', kind: 'revert_in_progress', desc: 'A revert is in progress.' },
      { file: 'BISECT_LOG', kind: 'bisect_in_progress', desc: 'A bisect is in progress.' },
    ];

    for (const c of checks) {
      if (!existsSync(join(gitDir, c.file))) continue;
      if (!this.shouldBlockOnState(operation, c.kind)) continue;
      issues.push({ kind: c.kind, description: c.desc, autoFixable: false });
    }
  }

  private shouldBlockOnState(operation: string, kind: PreflightIssue['kind']): boolean {
    if (kind === 'bisect_in_progress') {
      return MERGE_BLOCKING_OPS.has(operation);
    }
    return MERGE_BLOCKING_OPS.has(operation);
  }

  private async checkUnmergedPaths(operation: string, issues: PreflightIssue[]): Promise<void> {
    if (operation === 'completeMerge' || operation === 'abortMerge' ||
        operation === 'resolveOurs' || operation === 'resolveTheirs') return;

    let result;
    try {
      result = await this.git.exec(['diff', '--name-only', '--diff-filter=U']);
    } catch {
      return;
    }
    const paths = result.stdout.trim().split('\n').filter(Boolean);
    if (paths.length === 0) return;

    issues.push({
      kind: 'unmerged_paths',
      description: `${paths.length} unmerged path(s) in the index — resolve them before running ${operation}.`,
      autoFixable: false,
      paths,
    });
  }

  private async checkDirtyTree(issues: PreflightIssue[]): Promise<void> {
    let result;
    try {
      result = await this.git.exec(['status', '--porcelain']);
    } catch {
      return;
    }
    const dirty = result.stdout.trim();
    if (!dirty) return;

    const paths = dirty.split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => l.replace(/^\S+\s+/, ''));

    issues.push({
      kind: 'dirty_tree',
      description: `Working tree has ${paths.length} uncommitted change(s).`,
      autoFixable: false,
      paths,
    });
  }
}
