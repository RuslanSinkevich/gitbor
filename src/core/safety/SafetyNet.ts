import { join } from 'path';
import { GitExecutor, GitError } from '../git/GitExecutor';
import { OperationResult, SavedState } from '../git/types';
import { OperationJournal } from './OperationJournal';

interface WrapOptions {
  autoStash?: boolean;
  autoRollback?: boolean;
}

const AUTO_STASH_PREFIX = '[SkyFork auto-stash]';

export class SafetyNet {
  constructor(
    private readonly git: GitExecutor
  ) {}

  private getJournal(): OperationJournal {
    const gitDir = join(this.git.getCwd(), '.git');
    return new OperationJournal(gitDir);
  }

  async wrapDestructive<T>(
    operationName: string,
    params: Record<string, string>,
    operation: () => Promise<T>,
    options?: WrapOptions
  ): Promise<OperationResult<T>> {
    const autoStash = options?.autoStash ?? true;
    const autoRollback = options?.autoRollback ?? true;
    const journal = this.getJournal();

    const headHash = (await this.git.exec(['rev-parse', 'HEAD'])).stdout.trim();
    const branchName = (await this.git.exec(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();

    const statusResult = await this.git.exec(['status', '--porcelain']);
    const hasUncommitted = statusResult.stdout.trim().length > 0;

    let autoStashHash: string | undefined;

    if (hasUncommitted && autoStash) {
      const stashMsg = `${AUTO_STASH_PREFIX} before ${operationName} ${Object.values(params).join(' ')}`.trim();
      const stashResult = await this.git.exec(['stash', 'push', '-m', stashMsg]);
      if (stashResult.exitCode === 0) {
        const hashResult = await this.git.exec(['rev-parse', 'stash@{0}']);
        autoStashHash = hashResult.stdout.trim();
      } else {
        return { success: false, error: `Failed to auto-stash uncommitted changes: ${stashResult.stderr}`, rollbackAvailable: false };
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

      if (autoStashHash) {
        await this.tryRestoreAutoStash();
      }

      return { success: true, data: result, rollbackAvailable: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await journal.fail(journalId, errorMsg);

      if (autoRollback) {
        try {
          await this.git.exec(['reset', '--hard', headHash]);
          if (branchName !== 'HEAD') {
            await this.git.exec(['checkout', branchName]);
          }
          if (autoStashHash) {
            await this.tryRestoreAutoStash();
          }
        } catch {
          // rollback best-effort
        }
      }

      return { success: false, error: errorMsg, rollbackAvailable: true };
    }
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

  private async tryRestoreAutoStash(): Promise<void> {
    try {
      await this.git.exec(['stash', 'pop']);
    } catch {
      // stash pop conflict — stash remains, user will see in status
    }
  }
}
