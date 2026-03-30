import { writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { GitExecutor } from './GitExecutor';
import type { RebaseTodoEntry, RebaseTodoList, RebaseProgress, OperationResult } from './types';

export class RebaseManager {
  constructor(private readonly git: GitExecutor) {}

  /**
   * Get the list of commits that would be rebased interactively.
   * `onto` is the target commit (e.g., a branch name or hash).
   */
  async getTodoList(onto: string): Promise<RebaseTodoList> {
    const result = await this.git.exec([
      'log', '--reverse', '--format=%H %h %s', `${onto}..HEAD`,
    ]);

    const entries: RebaseTodoEntry[] = result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [hash, shortHash, ...rest] = line.split(' ');
        return {
          action: 'pick' as const,
          hash,
          shortHash,
          subject: rest.join(' '),
        };
      });

    return { onto, entries };
  }

  /**
   * Execute interactive rebase with the given todo entries.
   * Uses GIT_SEQUENCE_EDITOR to inject the todo list.
   */
  async executeRebase(onto: string, entries: RebaseTodoEntry[]): Promise<OperationResult> {
    const todoContent = entries
      .filter(e => e.action !== 'drop')
      .map(e => `${e.action} ${e.hash} ${e.subject}`)
      .join('\n') + '\n';

    const todoPath = join(tmpdir(), `skyfork-rebase-todo-${Date.now()}.txt`);
    await writeFile(todoPath, todoContent, 'utf-8');

    const escapedTodoPath = todoPath.replace(/\\/g, '/');

    const editorCmd = process.platform === 'win32'
      ? `cmd /c copy /y "${todoPath.replace(/\//g, '\\')}"` 
      : `cp "${escapedTodoPath}"`;

    try {
      const result = await this.git.exec(
        ['rebase', '-i', onto],
        {
          timeout: 60_000,
          env: { GIT_SEQUENCE_EDITOR: editorCmd },
        },
      );

      try { const { unlink } = await import('fs/promises'); await unlink(todoPath); } catch { /* cleanup */ }

      return {
        success: result.exitCode === 0,
        error: result.exitCode !== 0 ? result.stderr : undefined,
        rollbackAvailable: false,
      };
    } catch (err) {
      try { const { unlink } = await import('fs/promises'); await unlink(todoPath); } catch { /* cleanup */ }
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        rollbackAvailable: false,
      };
    }
  }

  /**
   * Check if a rebase is currently in progress.
   */
  async getProgress(): Promise<RebaseProgress> {
    const repoPath = this.git.getCwd();
    const gitDir = join(repoPath, '.git');

    try {
      await access(join(gitDir, 'rebase-merge'));
    } catch {
      try {
        await access(join(gitDir, 'rebase-apply'));
      } catch {
        return { inProgress: false, currentStep: 0, totalSteps: 0, currentHash: '', currentAction: '' };
      }
    }

    const dir = join(gitDir, 'rebase-merge');
    let step = 0, total = 0, hash = '', action = '';

    try {
      const msgnum = await readFile(join(dir, 'msgnum'), 'utf-8');
      step = parseInt(msgnum.trim(), 10);
    } catch { /* empty */ }

    try {
      const end = await readFile(join(dir, 'end'), 'utf-8');
      total = parseInt(end.trim(), 10);
    } catch { /* empty */ }

    try {
      const stopped = await readFile(join(dir, 'stopped-sha'), 'utf-8');
      hash = stopped.trim();
    } catch { /* empty */ }

    return { inProgress: true, currentStep: step, totalSteps: total, currentHash: hash, currentAction: action };
  }

  async continueRebase(): Promise<OperationResult> {
    const result = await this.git.exec(['rebase', '--continue']);
    return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined, rollbackAvailable: false };
  }

  async abortRebase(): Promise<OperationResult> {
    const result = await this.git.exec(['rebase', '--abort']);
    return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined, rollbackAvailable: false };
  }

  async skipRebase(): Promise<OperationResult> {
    const result = await this.git.exec(['rebase', '--skip']);
    return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined, rollbackAvailable: false };
  }
}
