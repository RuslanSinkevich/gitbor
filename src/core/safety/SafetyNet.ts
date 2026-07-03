import { existsSync } from 'fs';
import { join } from 'path';
import type { MergeResult } from '../git/types';
import { GitExecutor, GitError } from '../git/GitExecutor';
import {
  GitErrorClass,
  OperationResult,
  SavedState,
  SuggestedAction,
} from '../git/types';
import { OperationJournal } from './OperationJournal';
import { GitErrorClassifier } from '../git/GitErrorClassifier';
import { mainLogger } from '../utils/Logger';
import { recordErrorClass } from './SafetyStats';

export interface WrapOptions {
  autoStash?: boolean;
  /**
   * Классы ошибок, которые ОБЁРТКА считает "normal exit": возвращает
   * `success: false` БЕЗ rollback. Дефолт: `['conflict']` — merge с
   * конфликтами не катит назад, открывает редактор.
   */
  allowedErrorClasses?: GitErrorClass[];
  /**
   * Если true — UI сможет показать SafetyDialog и предложить действия
   * (renderer ждёт ответа). Если false — backend сам молча возвращает
   * OperationFailure без интерактивных подсказок (для скриптовых вызовов).
   * Сейчас используется как чисто-документирующий флаг; renderer всё
   * равно решает по `errorClass`.
   */
  interactive?: boolean;
  /**
   * Старое поведение: при любой ошибке делать `reset --hard` + `stash pop`.
   * False по дефолту. Включать только для backward-compat тестов.
   */
  legacyAutoRollback?: boolean;
  /** Legacy alias `autoRollback` → `legacyAutoRollback`. */
  autoRollback?: boolean;
}

const AUTO_STASH_PREFIX = '[GitBor auto-stash]';

export class SafetyNet {
  constructor(
    private readonly git: GitExecutor,
  ) {}

  private getJournal(): OperationJournal {
    const gitDir = join(this.git.getCwd(), '.git');
    return new OperationJournal(gitDir);
  }

  async wrapDestructive<T>(
    operationName: string,
    params: Record<string, string>,
    operation: () => Promise<T>,
    options?: WrapOptions,
  ): Promise<OperationResult<T>> {
    const autoStash = options?.autoStash ?? true;
    const allowedErrorClasses = options?.allowedErrorClasses ?? ['conflict'];
    // legacy alias
    const legacyAutoRollback = options?.legacyAutoRollback ?? options?.autoRollback ?? false;

    const journal = this.getJournal();

    const headHash = (await this.git.exec(['rev-parse', 'HEAD'])).stdout.trim();
    const branchName = (await this.git.exec(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();

    // Гvard перед auto-stash: stash push поломает индекс если есть UU.
    if (autoStash) {
      const uu = await this.detectUnmergedPaths();
      if (uu.length > 0) {
        return {
          success: false,
          rollbackAvailable: false,
          errorClass: 'unmerged_paths',
          error: `Cannot stash: ${uu.length} unmerged path(s) — resolve conflicts first.`,
          suggestedActions: [
            { kind: 'continue_merge' },
            { kind: 'abort_merge' },
            { kind: 'cancel' },
          ],
        };
      }
    }

    const statusResult = await this.git.exec(['status', '--porcelain']);
    const hasUncommitted = statusResult.stdout.trim().length > 0;

    let autoStashHash: string | undefined;

    if (hasUncommitted && autoStash) {
      const stashMsg = `${AUTO_STASH_PREFIX} before ${operationName} ${Object.values(params).join(' ')}`.trim();
      // `-u`: auto-stash забирает и новые (untracked) файлы. Без него новые
      // файлы остаются в рабочей копии и «протекают» между ветками при
      // checkout/pull — осознанно включаем по умолчанию.
      const stashResult = await this.git.exec(['stash', 'push', '-u', '-m', stashMsg]);
      if (stashResult.exitCode === 0) {
        const hashResult = await this.git.exec(['rev-parse', 'stash@{0}']);
        autoStashHash = hashResult.stdout.trim();
      } else {
        // Stash push сам упал — это уже могла быть транзитная причина (lock).
        const classified = GitErrorClassifier.classify(stashResult.stderr);
        return {
          success: false,
          rollbackAvailable: false,
          errorClass: classified.class,
          error: `Failed to auto-stash uncommitted changes: ${stashResult.stderr}`,
          suggestedActions: this.buildActions(classified.class, undefined),
        };
      }
    }

    const savedState: SavedState = {
      headHash,
      branchName,
      hasUncommitted,
      autoStashHash,
    };

    const journalId = await journal.begin({
      operation: operationName,
      savedState,
      params,
    });

    try {
      const result = await operation();

      await journal.complete(journalId);

      // Не возвращаем auto-stash пока merge/cherry-pick/rebase/UU ещё активны:
      // stash apply во время MERGE_HEAD — типичный источник index.lock и
      // «потерянного» состояния после merge с конфликтами.
      if (autoStashHash && !(await this.shouldDeferAutoStashRestore(operationName, result))) {
        await this.tryRestoreAutoStash(autoStashHash);
      }

      return { success: true, data: result, rollbackAvailable: true, journalEntryId: journalId };
    } catch (error) {
      const stderr = error instanceof GitError ? error.stderr : '';
      const errorMsg = error instanceof Error ? error.message : String(error);

      const classified = GitErrorClassifier.classify(stderr || errorMsg);
      const errorClass = classified.class;
      const severity = classified.severity;
      const hookOutput = classified.hookOutput;

      mainLogger.warn(
        `safety: classified ${errorClass}, first line: ${(stderr || errorMsg).split('\n')[0].slice(0, 200)}`,
      );
      recordErrorClass(errorClass);

      await journal.fail(journalId, errorMsg, errorClass);

      // allowed (conflict / dirty_tree / etc) — нет rollback'а, возвращаем как есть.
      if (allowedErrorClasses.includes(errorClass)) {
        return {
          success: false,
          error: errorMsg,
          rollbackAvailable: true,
          errorClass,
          severity,
          hookOutput,
          savedState: { headHash, branchName, autoStashHash },
          suggestedActions: this.buildActions(errorClass, autoStashHash, journalId),
          journalEntryId: journalId,
        };
      }

      // legacy: тупой rollback. Только если опт-ин.
      if (legacyAutoRollback) {
        try {
          await this.git.exec(['reset', '--hard', headHash]);
          if (branchName !== 'HEAD') {
            await this.git.exec(['checkout', branchName]);
          }
          if (autoStashHash) {
            await this.tryRestoreAutoStash(autoStashHash);
          }
        } catch {
          // best-effort
        }
        return {
          success: false,
          error: errorMsg,
          rollbackAvailable: true,
          errorClass,
          severity,
          hookOutput,
          savedState: { headHash, branchName, autoStashHash },
          journalEntryId: journalId,
        };
      }

      // Транзитные и неизвестные — никакого rollback'а. Backend готовит
      // savedState + actions, UI показывает SafetyDialog.
      return {
        success: false,
        error: errorMsg,
        rollbackAvailable: true,
        errorClass,
        severity,
        hookOutput,
        savedState: { headHash, branchName, autoStashHash },
        suggestedActions: this.buildActions(errorClass, autoStashHash, journalId),
        journalEntryId: journalId,
      };
    }
  }

  /** Сборка suggested-actions по классу ошибки. */
  private buildActions(
    errorClass: GitErrorClass,
    stashHash: string | undefined,
    journalEntryId?: string,
  ): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    switch (errorClass) {
      case 'lock_held':
        actions.push({ kind: 'remove_lock' });
        if (journalEntryId) actions.push({ kind: 'retry', payload: { journalEntryId } });
        break;
      case 'network':
      case 'auth':
        if (journalEntryId) actions.push({ kind: 'retry', payload: { journalEntryId } });
        break;
      case 'conflict':
        actions.push({ kind: 'continue_merge' });
        actions.push({ kind: 'abort_merge' });
        break;
      case 'dirty_tree':
      case 'untracked_overwrite':
        if (journalEntryId) actions.push({ kind: 'rollback', payload: { journalEntryId } });
        break;
      case 'merge_in_progress':
        actions.push({ kind: 'continue_merge' });
        actions.push({ kind: 'abort_merge' });
        break;
      case 'rebase_in_progress':
        actions.push({ kind: 'abort_rebase' });
        actions.push({ kind: 'manual_continue' });
        break;
      case 'unmerged_paths':
        actions.push({ kind: 'continue_merge' });
        actions.push({ kind: 'abort_merge' });
        break;
      case 'non_fast_forward':
      case 'preflight_blocked':
      case 'unknown':
      default:
        if (journalEntryId) actions.push({ kind: 'rollback', payload: { journalEntryId } });
        break;
    }

    if (stashHash) {
      actions.push({ kind: 'apply_stash_only', payload: { stashHash } });
      actions.push({ kind: 'drop_stash', payload: { stashHash } });
    }

    actions.push({ kind: 'cancel' });
    return actions;
  }

  async rollback(journalEntryId: string): Promise<void> {
    const journal = this.getJournal();
    const entries = await journal.getAll();
    const entry = entries.find(e => e.id === journalEntryId);
    if (!entry) {
      throw new Error(`Journal entry ${journalEntryId} not found`);
    }

    const { headHash, branchName, autoStashHash } = entry.savedState;

    await this.git.exec(['reset', '--hard', headHash]);

    if (branchName !== 'HEAD') {
      await this.git.exec(['checkout', branchName]);
    }

    if (autoStashHash) {
      try {
        await this.git.exec(['stash', 'apply', autoStashHash]);
      } catch {
        // stash apply may conflict — user will see in status
      }
    }
  }

  async restoreAutoStash(stashHash: string): Promise<void> {
    await this.git.exec(['stash', 'apply', stashHash]);
  }

  /**
   * Восстановление авто-стэша после успешной операции. Stratification:
   * apply → если success → drop. Если apply упал — стэш остаётся в
   * списке, юзер сам разберётся (видит в Stashes); БЕЗ pop, который
   * скрывал ошибки.
   */
  private async tryRestoreAutoStash(stashHash: string): Promise<void> {
    const applyResult = await this.git.exec(['stash', 'apply', stashHash]);
    if (applyResult.exitCode !== 0) {
      mainLogger.warn(`safety: auto-stash apply failed (${stashHash.slice(0, 7)}), keeping stash. stderr: ${applyResult.stderr.split('\n')[0]}`);
      return;
    }
    // apply OK → drop одноразовую запись из stash list.
    const dropResult = await this.git.exec(['stash', 'drop', stashHash]);
    if (dropResult.exitCode !== 0) {
      mainLogger.warn(`safety: auto-stash drop failed (${stashHash.slice(0, 7)}). stderr: ${dropResult.stderr.split('\n')[0]}`);
    }
  }

  /**
   * Отложить restore auto-stash после «успешного» wrapDestructive, если
   * операция оставила репо в конфликтной сессии (merge с UU и т.п.).
   */
  private async shouldDeferAutoStashRestore(operationName: string, result: unknown): Promise<boolean> {
    if (operationName === 'merge' && result && typeof result === 'object' && 'success' in result) {
      const mr = result as MergeResult;
      if (!mr.success && (mr.conflicts?.length ?? 0) > 0) return true;
    }
    if (this.isConflictSessionActive()) return true;
    const uu = await this.detectUnmergedPaths();
    return uu.length > 0;
  }

  private isConflictSessionActive(): boolean {
    const gitDir = join(this.git.getCwd(), '.git');
    if (existsSync(join(gitDir, 'MERGE_HEAD'))) return true;
    if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) return true;
    if (existsSync(join(gitDir, 'REVERT_HEAD'))) return true;
    if (existsSync(join(gitDir, 'rebase-apply')) || existsSync(join(gitDir, 'rebase-merge'))) return true;
    return false;
  }

  private async detectUnmergedPaths(): Promise<string[]> {
    try {
      const r = await this.git.exec(['diff', '--name-only', '--diff-filter=U']);
      if (!r.stdout.trim()) return [];
      return r.stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}
