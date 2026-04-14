import { existsSync } from 'fs';
import { join } from 'path';
import { GitExecutor, GitError } from '../git/GitExecutor';
import * as GitParser from '../git/GitParser';
import {
  ConflictFile,
  MergeOptions,
  MergeResult,
  MergeState,
  OperationResult,
} from '../git/types';

export class ConflictManager {
  constructor(
    private readonly git: GitExecutor,
  ) {}

  async predictConflicts(source: string, target: string): Promise<string[]> {
    try {
      const baseResult = await this.git.exec(['merge-base', source, target]);
      if (baseResult.exitCode !== 0) return [];

      const base = baseResult.stdout.trim();
      const treeResult = await this.git.exec(['merge-tree', base, target, source]);

      const conflicts: string[] = [];
      const lines = treeResult.stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('+<<<<<<<') || line.includes('changed in both')) {
          const fileMatch = line.match(/(\S+)$/);
          if (fileMatch) conflicts.push(fileMatch[1]);
        }
      }
      return [...new Set(conflicts)];
    } catch {
      return [];
    }
  }

  async merge(source: string, options: MergeOptions): Promise<MergeResult> {
    const args = ['merge'];
    if (options.noCommit) args.push('--no-commit');
    if (options.squash) args.push('--squash');
    if (options.ffOnly) args.push('--ff-only');
    if (options.noFf) args.push('--no-ff');
    args.push(source);

    const result = await this.git.exec(args);

    if (result.exitCode === 0) {
      return { success: true, conflicts: [] };
    }

    const conflicts = await this.getConflictFileNames();
    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    throw new GitError(
      `Merge failed: ${result.stderr}`,
      'merge',
      result.exitCode,
      result.stderr
    );
  }

  async getConflictFiles(): Promise<ConflictFile[]> {
    const statusResult = await this.git.exec(['status', '--porcelain=v1']);
    const allFiles = GitParser.parseStatus(statusResult.stdout);

    const conflictPaths = new Set(allFiles.filter(f => f.status === 'U').map(f => f.path));
    const stagedPaths = new Set(allFiles.filter(f => f.staged && f.status === 'M').map(f => f.path));

    const result: ConflictFile[] = [];
    for (const path of conflictPaths) {
      result.push({ path, status: 'conflicted', oursModified: true, theirsModified: true });
    }
    for (const path of stagedPaths) {
      if (!conflictPaths.has(path)) {
        result.push({ path, status: 'resolved', oursModified: true, theirsModified: true });
      }
    }
    return result;
  }

  async getMergeState(): Promise<MergeState> {
    const inProgress = await this.isMergeInProgress();
    if (!inProgress) {
      return {
        inProgress: false,
        sourceBranch: '',
        targetBranch: '',
        totalConflicts: 0,
        resolvedConflicts: 0,
        conflictFiles: [],
      };
    }

    const conflictFiles = await this.getConflictFiles();
    const conflicted = conflictFiles.filter(f => f.status === 'conflicted').length;
    const total = conflictFiles.length;

    const targetBranch = (await this.git.exec(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();

    let sourceBranch: string;
    try {
      const mergeHeadHash = (await this.git.exec(['rev-parse', 'MERGE_HEAD'])).stdout.trim();
      const branchResult = await this.git.exec(['branch', '--points-at', mergeHeadHash, '--format=%(refname:short)']);
      const branches = branchResult.stdout.trim().split('\n').filter(Boolean);
      sourceBranch = branches[0] || mergeHeadHash.substring(0, 7);
    } catch {
      sourceBranch = 'unknown';
    }

    return {
      inProgress: true,
      sourceBranch,
      targetBranch,
      totalConflicts: total,
      resolvedConflicts: total - conflicted,
      conflictFiles,
    };
  }

  async resolveWithOurs(file: string): Promise<void> {
    await this.git.exec(['checkout', '--ours', '--', file]);
    await this.git.exec(['add', '--', file]);
  }

  async resolveWithTheirs(file: string): Promise<void> {
    await this.git.exec(['checkout', '--theirs', '--', file]);
    await this.git.exec(['add', '--', file]);
  }

  async stageResolved(file: string): Promise<void> {
    await this.git.exec(['add', '--', file]);
  }

  async completeMerge(message?: string): Promise<OperationResult> {
    const unresolved = await this.getConflictFileNames();
    if (unresolved.length > 0) {
      return {
        success: false,
        error: 'Not all conflicts are resolved',
        rollbackAvailable: false,
      };
    }

    const conflictFiles = await this.getConflictFiles();
    const resolvedPaths = conflictFiles
      .filter(f => f.status === 'resolved')
      .map(f => f.path);

    if (resolvedPaths.length > 0) {
      await this.git.exec(['add', '--', ...resolvedPaths]);
    }

    const commitResult = message
      ? await this.git.exec(['commit', '-m', message])
      : await this.git.exec(['commit', '--no-edit']);

    if (commitResult.exitCode !== 0) {
      return { success: false, error: `Commit failed: ${commitResult.stderr}`, rollbackAvailable: false };
    }

    return { success: true, rollbackAvailable: true };
  }

  async abortMerge(): Promise<void> {
    await this.git.exec(['merge', '--abort']);
  }

  async isMergeInProgress(): Promise<boolean> {
    const gitDir = join(this.git.getCwd(), '.git');
    return existsSync(join(gitDir, 'MERGE_HEAD'));
  }

  private async getConflictFileNames(): Promise<string[]> {
    try {
      const result = await this.git.exec(['diff', '--name-only', '--diff-filter=U']);
      if (!result.stdout.trim()) return [];
      return result.stdout.trim().split('\n');
    } catch {
      return [];
    }
  }
}
