import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { GitExecutor } from '../git/GitExecutor';
import { RecoveryAction, RecoveryIssue, RecoveryReport } from '../git/types';
import { OperationJournal } from './OperationJournal';
import { SafetyNet } from './SafetyNet';
import { cleanupTmpFiles } from './AtomicWrite';

const AUTO_STASH_PREFIX = '[SkyFork auto-stash]';

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
      case 'ignore':
        break;
    }
  }

  private async checkLockFiles(gitDir: string, issues: RecoveryIssue[]): Promise<void> {
    const lockPath = join(gitDir, 'index.lock');
    if (existsSync(lockPath)) {
      issues.push({
        type: 'lock_file',
        description: 'Обнаружен .git/index.lock от крашнувшего git-процесса.',
        suggestedAction: { type: 'remove_lock' },
      });
    }
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
      const { statSync } = require('fs');
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
