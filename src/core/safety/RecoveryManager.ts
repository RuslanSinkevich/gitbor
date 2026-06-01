import { existsSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { GitExecutor } from '../git/GitExecutor';
import { OperationResult, RecoveryAction, RecoveryIssue, RecoveryReport } from '../git/types';
import { OperationJournal } from './OperationJournal';
import { SafetyNet } from './SafetyNet';
import { findGitProcesses } from './GitProcessDetector';
import { cleanupTmpFiles } from './AtomicWrite';
import { mainLogger } from '../utils/Logger';

const AUTO_STASH_PREFIX = '[GitBor auto-stash]';

/**
 * Если index.lock старше этого возраста — он точно не от текущей git-операции.
 * `git add`/`commit` держат lock миллисекунды-доли секунды; всё что прожило
 * 15+ секунд — stale-остаток от убитого процесса (наш SIGTERM на выходе или
 * краш). Безопасно удаляем без диалога, иначе юзер видит сообщение «обнаружен
 * .git/index.lock от крашнувшего git-процесса» при каждом запуске.
 */
const STALE_LOCK_AGE_MS = 15_000;

export class RecoveryManager {
  constructor(
    private readonly git: GitExecutor,
    private readonly journal: OperationJournal,
    private readonly safetyNet: SafetyNet
  ) {}

  async checkOnStartup(): Promise<RecoveryReport> {
    const issues: RecoveryIssue[] = [];
    const gitDir = join(this.git.getCwd(), '.git');

    cleanupTmpFiles(gitDir);
    cleanupTmpFiles(this.git.getCwd());

    await this.checkLockFiles(gitDir, issues);
    await this.checkJournal(issues);
    await this.checkMergeState(gitDir, issues);
    await this.checkRebaseState(gitDir, issues);
    await this.checkOrphanedAutoStash(issues);

    await this.journal.cleanup();

    return { hasIssues: issues.length > 0, issues };
  }

  async executeRecovery(action: RecoveryAction): Promise<void> {
    switch (action.type) {
      case 'rollback':
        await this.safetyNet.rollback(action.journalEntryId);
        break;
      case 'abort_merge':
        await this.git.exec(['merge', '--abort']);
        break;
      case 'continue_merge': {
        const unresolved = await this.git.exec(['diff', '--name-only', '--diff-filter=U']);
        if (unresolved.stdout.trim()) {
          throw new Error(
            `Cannot continue merge: ${unresolved.stdout.trim().split('\n').length} unresolved conflict(s). Resolve them first or abort.`
          );
        }
        await this.git.exec(['commit', '--no-edit']);
        break;
      }
      case 'abort_rebase':
        await this.git.exec(['rebase', '--abort']);
        break;
      case 'continue_rebase':
        await this.git.exec(['rebase', '--continue']);
        break;
      case 'remove_lock':
        this.removeLockFile();
        break;
      case 'restore_stash':
        await this.safetyNet.restoreAutoStash(action.stashHash);
        break;
      case 'apply_stash_only':
        await this.applyStashOnly(action.stashHash);
        break;
      case 'drop_stash':
        await this.dropStashByHash(action.stashHash);
        break;
      case 'kill_git_process':
        await this.killGitProcess(action.pid);
        break;
      case 'retry':
        // Реальный re-run делает UI через postCommand. Здесь — no-op,
        // мы только подтверждаем, что юзер выбрал retry; запись в журнале
        // остаётся как 'failed' до новой попытки.
        break;
      case 'manual_continue':
        // No-op: юзер сам зашёл в терминал / VS Code; backend не делает ничего.
        break;
      case 'ignore':
        break;
    }
  }

  async applyStash(hash: string): Promise<OperationResult> {
    const r = await this.git.exec(['stash', 'apply', hash]);
    if (r.exitCode === 0) return { success: true, rollbackAvailable: false };
    return { success: false, error: r.stderr, rollbackAvailable: false };
  }

  async dropStash(hash: string): Promise<OperationResult> {
    const r = await this.git.exec(['stash', 'drop', hash]);
    if (r.exitCode === 0) return { success: true, rollbackAvailable: false };
    return { success: false, error: r.stderr, rollbackAvailable: false };
  }

  /**
   * SIGTERM по pid + защита: процесс должен быть в актуальном
   * `findGitProcesses` для активного репо. Иначе отказ — нельзя дать
   * юзеру через UI убить произвольный pid.
   */
  async killGitProcess(pid: number): Promise<void> {
    const procs = await findGitProcesses().catch(() => []);
    const isGit = procs.some(p => p.pid === pid);
    if (!isGit) {
      throw new Error(`Process ${pid} is not a git process or has already exited`);
    }
    try {
      process.kill(pid, 'SIGTERM');
      mainLogger.info(`recovery: SIGTERM sent to git pid=${pid}`);
    } catch (err) {
      mainLogger.warn(`recovery: kill ${pid} failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /**
   * Реиграть операцию по journal entry. Используется UI через `retry`
   * action: журнал хранит operation+params, тут восстанавливаем команду.
   * НЕ универсально (не все операции восстановимы из params), для
   * нынешнего скоупа — лишь идемпотентный re-exec через safetyNet.
   */
  async retryOperation(journalEntryId: string): Promise<OperationResult> {
    const entries = await this.journal.getAll();
    const entry = entries.find(e => e.id === journalEntryId);
    if (!entry) {
      return { success: false, error: `Journal entry ${journalEntryId} not found`, rollbackAvailable: false };
    }
    // Сам re-run происходит через postCommand из renderer — этот метод
    // существует только как симметрия API, чтобы main мог дать ответ
    // на безусловный retry без сложной логики.
    return { success: true, rollbackAvailable: false };
  }

  private async applyStashOnly(hash: string): Promise<void> {
    const r = await this.git.exec(['stash', 'apply', hash]);
    if (r.exitCode !== 0) throw new Error(`stash apply failed: ${r.stderr}`);
  }

  private async dropStashByHash(hash: string): Promise<void> {
    const r = await this.git.exec(['stash', 'drop', hash]);
    if (r.exitCode !== 0) throw new Error(`stash drop failed: ${r.stderr}`);
  }

  private async checkLockFiles(gitDir: string, issues: RecoveryIssue[]): Promise<void> {
    const lockPath = join(gitDir, 'index.lock');
    if (!existsSync(lockPath)) return;

    // Старые lock'и от убитого git-процесса (наш SIGTERM на выходе) удаляем
    // тихо, без диалога. Молодые — могут быть от параллельно запущенного git
    // (например, юзер открыл терминал и делает там commit) — спрашиваем.
    let ageMs: number;
    try {
      ageMs = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      return; // lock пропал между existsSync и statSync — гонка, ничего не делаем
    }

    if (ageMs >= STALE_LOCK_AGE_MS) {
      try {
        unlinkSync(lockPath);
        mainLogger.info(`recovery: removed stale .git/index.lock (age=${Math.round(ageMs / 1000)}s)`);
      } catch (err) {
        // Не удалось — оставим как issue, юзер решит вручную.
        mainLogger.warn(`recovery: failed to remove stale lock: ${err instanceof Error ? err.message : String(err)}`);
        issues.push({
          type: 'lock_file',
          description: 'Обнаружен .git/index.lock от крашнувшего git-процесса.',
          suggestedAction: { type: 'remove_lock' },
        });
      }
      return;
    }

    issues.push({
      type: 'lock_file',
      description: 'Обнаружен .git/index.lock от крашнувшего git-процесса.',
      suggestedAction: { type: 'remove_lock' },
    });
  }

  private async checkJournal(issues: RecoveryIssue[]): Promise<void> {
    const incomplete = await this.journal.getIncomplete();
    for (const entry of incomplete) {
      issues.push({
        type: 'interrupted_operation',
        description: `Прерванная операция "${entry.operation}" (${new Date(entry.startedAt).toLocaleString()}).`,
        journalEntry: entry,
        suggestedAction: { type: 'rollback', journalEntryId: entry.id },
      });
    }
  }

  private async checkMergeState(gitDir: string, issues: RecoveryIssue[]): Promise<void> {
    if (existsSync(join(gitDir, 'MERGE_HEAD'))) {
      issues.push({
        type: 'unfinished_merge',
        description: 'Обнаружен незавершённый merge.',
        suggestedAction: { type: 'abort_merge' },
      });
    }
  }

  private async checkRebaseState(gitDir: string, issues: RecoveryIssue[]): Promise<void> {
    if (existsSync(join(gitDir, 'rebase-apply')) || existsSync(join(gitDir, 'rebase-merge'))) {
      issues.push({
        type: 'unfinished_rebase',
        description: 'Обнаружен незавершённый rebase.',
        suggestedAction: { type: 'abort_rebase' },
      });
    }
  }

  private async checkOrphanedAutoStash(issues: RecoveryIssue[]): Promise<void> {
    try {
      const stashResult = await this.git.exec(['stash', 'list']);
      if (!stashResult.stdout.trim()) return;

      const incomplete = await this.journal.getIncomplete();
      const incompleteStashHashes = new Set(
        incomplete.map(e => e.savedState.autoStashHash).filter((h): h is string => !!h)
      );

      for (const line of stashResult.stdout.trim().split('\n')) {
        if (!line.includes(AUTO_STASH_PREFIX)) continue;
        const hashMatch = line.match(/^stash@\{(\d+)\}/);
        if (!hashMatch) continue;

        const stashRef = `stash@{${hashMatch[1]}}`;
        const hashResult = await this.git.exec(['rev-parse', stashRef]);
        const stashHash = hashResult.stdout.trim();

        if (!incompleteStashHashes.has(stashHash)) {
          issues.push({
            type: 'orphaned_auto_stash',
            description: `Осиротевший auto-stash: ${line.trim()}`,
            suggestedAction: { type: 'restore_stash', stashHash },
          });
        }
      }
    } catch {
      // no stashes or git error — skip
    }
  }

  private removeLockFile(): void {
    const lockPath = join(this.git.getCwd(), '.git', 'index.lock');
    try {
      const stat = statSync(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 2000) {
        throw new Error('Lock file is fresh — git may still be running');
      }
      unlinkSync(lockPath);
    } catch {
      // lock gone, too fresh, or fs error — skip
    }
  }
}
