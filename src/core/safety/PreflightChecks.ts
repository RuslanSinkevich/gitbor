import { existsSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { GitExecutor } from '../git/GitExecutor';
import type { PreflightIssue, PreflightReport } from '../git/types';
import { findGitProcesses } from './GitProcessDetector';
import { mainLogger } from '../utils/Logger';

/**
 * Pre-flight проверки ПЕРЕД destructive операцией. Цель: не входить
 * в `wrapDestructive`, если репо в состоянии, где операция точно
 * упадёт (или может упасть по транзитной причине).
 *
 * Контракт:
 *   - `ok=true` — все блокеры разрешены (stale-lock удалён молча,
 *     state-файлов нет, UU нет);
 *   - `ok=false` — есть `issues[]`, юзер должен решить через SafetyDialog;
 *   - проверки read-only, кроме автоудаления stale `index.lock` (см.
 *     STALE_LOCK_AGE_MS — это backport уже работающего RecoveryManager).
 */
export const STALE_LOCK_AGE_MS = 15_000;

export interface PreflightOptions {
  /** Проверять dirty-tree (для checkout/rebase). Большинство destructive ops это терпят. */
  checkDirtyTree?: boolean;
  /** Не удалять stale lock автоматически (для тестов). */
  noAutoRemoveStaleLock?: boolean;
}

/** Операции, для которых наличие MERGE_HEAD — критический блок. */
const MERGE_BLOCKING_OPS = new Set(['merge', 'pull', 'rebase', 'cherry-pick', 'revert', 'checkout']);
/** Операции, которые требуют чистого дерева. */
const DIRTY_BLOCKING_OPS = new Set(['checkout', 'rebase']);

export class PreflightChecks {
  constructor(private readonly git: GitExecutor) {}

  async check(
    repoPath: string,
    operation: string,
    opts: PreflightOptions = {},
  ): Promise<PreflightReport> {
    const issues: PreflightIssue[] = [];
    const gitDir = join(repoPath, '.git');

    await this.checkLock(gitDir, repoPath, issues, opts);
    await this.checkStateFiles(gitDir, operation, issues);
    await this.checkUnmergedPaths(operation, issues);

    if (opts.checkDirtyTree || DIRTY_BLOCKING_OPS.has(operation)) {
      await this.checkDirtyTree(issues);
    }

    return { ok: issues.length === 0, issues };
  }

  private async checkLock(
    gitDir: string,
    repoPath: string,
    issues: PreflightIssue[],
    opts: PreflightOptions,
  ): Promise<void> {
    const lockPath = join(gitDir, 'index.lock');
    if (!existsSync(lockPath)) return;

    let ageMs: number;
    try {
      ageMs = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      return; // гонка: пропал между existsSync и statSync
    }

    if (ageMs >= STALE_LOCK_AGE_MS && !opts.noAutoRemoveStaleLock) {
      try {
        unlinkSync(lockPath);
        mainLogger.info(`preflight: removed stale .git/index.lock (age=${Math.round(ageMs / 1000)}s)`);
        return;
      } catch (err) {
        mainLogger.warn(`preflight: failed to remove stale lock: ${err instanceof Error ? err.message : String(err)}`);
        issues.push({
          kind: 'lock_stale',
          description: `Stale .git/index.lock (age ${Math.round(ageMs / 1000)}s) — cannot remove.`,
          autoFixable: true,
        });
        return;
      }
    }

    // Свежий lock — пытаемся найти git-процессы для информативного диалога.
    const procs = await findGitProcesses(repoPath).catch(() => []);
    issues.push({
      kind: 'lock_held_fresh',
      description: `Another git process is holding .git/index.lock (age ${Math.round(ageMs / 1000)}s).`,
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
      // Блокируем только операции, которые точно конфликтуют с этим состоянием.
      if (!this.shouldBlockOnState(operation, c.kind)) continue;
      issues.push({ kind: c.kind, description: c.desc, autoFixable: false });
    }
  }

  private shouldBlockOnState(operation: string, kind: PreflightIssue['kind']): boolean {
    if (kind === 'bisect_in_progress') {
      // bisect блокирует только write-ops, не checkout (его сам bisect делает).
      return MERGE_BLOCKING_OPS.has(operation);
    }
    return MERGE_BLOCKING_OPS.has(operation);
  }

  private async checkUnmergedPaths(operation: string, issues: PreflightIssue[]): Promise<void> {
    // UU блокирует любую destructive операцию, кроме самих merge-резолверов.
    if (operation === 'completeMerge' || operation === 'abortMerge' ||
        operation === 'resolveOurs' || operation === 'resolveTheirs') return;

    let result;
    try {
      result = await this.git.exec(['diff', '--name-only', '--diff-filter=U']);
    } catch {
      return; // если git упал — лучше пропустить, чем заблокировать UI
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
