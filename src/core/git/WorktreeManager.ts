import { GitExecutor, GitError } from './GitExecutor';

/** Info about a single worktree. */
export interface WorktreeInfo {
  path: string;
  branch: string;
  hash: string;
  isBare: boolean;
  isMain: boolean;
}

/** Manages `git worktree` operations — list, add, remove. */
export class WorktreeManager {
  constructor(private readonly git: GitExecutor) {}

  /** Lists all worktrees. */
  async list(): Promise<WorktreeInfo[]> {
    const r = await this.git.exec(['worktree', 'list', '--porcelain']);
    return parseWorktreeList(r.stdout);
  }

  /** Adds a new worktree at `path` for `branch`. Creates branch if needed. */
  async add(path: string, branch: string, createBranch: boolean): Promise<string> {
    const args = ['worktree', 'add'];
    if (createBranch) args.push('-b', branch, path);
    else args.push(path, branch);
    const r = await this.git.exec(args);
    // Раньше отказ git молча проглатывался — в UI «ничего не произошло».
    if (r.exitCode !== 0) throw new GitError(`Add worktree failed: ${r.stderr}`, 'worktree', r.exitCode, r.stderr);
    return r.stdout + r.stderr;
  }

  /** Removes a worktree. */
  async remove(path: string, force: boolean): Promise<void> {
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(path);
    const r = await this.git.exec(args);
    if (r.exitCode !== 0) throw new GitError(`Remove worktree failed: ${r.stderr}`, 'worktree', r.exitCode, r.stderr);
  }
}

/** Parses `git worktree list --porcelain` output. */
function parseWorktreeList(raw: string): WorktreeInfo[] {
  const entries: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};
  let isFirst = true;

  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) {
        entries.push(finalize(current, isFirst));
        isFirst = false;
      }
      current = { path: line.substring(9).trim() };
    } else if (line.startsWith('HEAD ')) {
      current.hash = line.substring(5).trim();
    } else if (line.startsWith('branch ')) {
      current.branch = line.substring(7).trim().replace('refs/heads/', '');
    } else if (line === 'bare') {
      current.isBare = true;
    } else if (line === 'detached') {
      current.branch = '(detached)';
    } else if (line.trim() === '' && current.path) {
      entries.push(finalize(current, isFirst));
      isFirst = false;
      current = {};
    }
  }

  if (current.path) entries.push(finalize(current, isFirst));
  return entries;
}

function finalize(partial: Partial<WorktreeInfo>, isFirst: boolean): WorktreeInfo {
  return {
    path: partial.path || '',
    branch: partial.branch || '',
    hash: partial.hash ? partial.hash.substring(0, 7) : '',
    isBare: partial.isBare || false,
    isMain: isFirst,
  };
}
