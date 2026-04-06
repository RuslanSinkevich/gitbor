import { GitExecutor, GitError } from '../git/GitExecutor';
import { parseDiff } from '../git/DiffParser';
import * as GitParser from '../git/GitParser';
import { MergeResult, OperationResult, DiffHunk, DiffLine } from '../git/types';
import { OperationQueue } from '../safety/OperationQueue';
import { SafetyNet } from '../safety/SafetyNet';
import { StateManager } from '../state/StateManager';

function simpleResult(exitCode: number, stderr: string): OperationResult {
  return { success: exitCode === 0, error: exitCode !== 0 ? stderr : undefined, rollbackAvailable: false };
}

export async function checkout(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, branch: string): Promise<OperationResult> {
  return queue.enqueueWrite('checkout', async () => {
    const result = await safety.wrapDestructive('checkout', { branch }, async () => {
      const r = await git.exec(['checkout', branch]);
      if (r.exitCode !== 0) throw new GitError(`Checkout failed: ${r.stderr}`, 'checkout', r.exitCode, r.stderr);
    });
    await state.refreshAll();
    return result;
  });
}

export async function fetch(queue: OperationQueue, git: GitExecutor, state: StateManager, remote?: string): Promise<OperationResult> {
  return queue.enqueueWrite('fetch', async () => {
    const args = remote ? ['fetch', '--prune', remote] : ['fetch', '--all', '--prune'];
    const r = await git.exec(args);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function pull(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, rebase?: boolean): Promise<OperationResult> {
  return queue.enqueueWrite('pull', async () => {
    const result = await safety.wrapDestructive('pull', {}, async () => {
      const args = rebase ? ['pull', '--rebase'] : ['pull'];
      const r = await git.exec(args);
      if (r.exitCode !== 0) throw new GitError(`Pull failed: ${r.stderr}`, 'pull', r.exitCode, r.stderr);
    });
    await state.refreshAll();
    return result;
  });
}

export async function push(queue: OperationQueue, git: GitExecutor, state: StateManager, force?: boolean, setUpstream?: boolean): Promise<OperationResult> {
  return queue.enqueueWrite('push', async () => {
    const args = ['push'];
    if (force) args.push('--force-with-lease');
    if (setUpstream) args.push('-u', 'origin', 'HEAD');
    const r = await git.exec(args);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function stash(queue: OperationQueue, git: GitExecutor, state: StateManager, message?: string): Promise<OperationResult> {
  return queue.enqueueWrite('stash', async () => {
    const args = ['stash', 'push'];
    if (message) args.push('-m', message);
    const r = await git.exec(args);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function stashPop(queue: OperationQueue, git: GitExecutor, state: StateManager): Promise<OperationResult> {
  return queue.enqueueWrite('stashPop', async () => {
    const r = await git.exec(['stash', 'pop']);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function merge(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, branch: string): Promise<OperationResult<MergeResult>> {
  return queue.enqueueWrite('merge', async () => {
    const result = await safety.wrapDestructive('merge', { branch }, async () => {
      const r = await git.exec(['merge', branch]);
      if (r.exitCode !== 0 && (r.stdout.includes('CONFLICT') || r.stderr.includes('CONFLICT'))) {
        const statusResult = await git.exec(['status', '--porcelain=v1']);
        const conflicts = GitParser.parseStatus(statusResult.stdout).filter(f => f.status === 'U').map(f => f.path);
        return { success: false, conflicts } satisfies MergeResult;
      }
      if (r.exitCode !== 0) throw new GitError(`Merge failed: ${r.stderr}`, 'merge', r.exitCode, r.stderr);
      return { success: true, conflicts: [] } satisfies MergeResult;
    });
    await state.refreshAll();
    return result;
  });
}

export async function createBranch(queue: OperationQueue, git: GitExecutor, state: StateManager, name: string, from: string): Promise<OperationResult> {
  return queue.enqueueWrite('createBranch', async () => {
    const r = await git.exec(['branch', name, from]);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function renameBranch(queue: OperationQueue, git: GitExecutor, state: StateManager, oldName: string, newName: string): Promise<OperationResult> {
  return queue.enqueueWrite('renameBranch', async () => {
    const r = await git.exec(['branch', '-m', oldName, newName]);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function deleteBranch(queue: OperationQueue, git: GitExecutor, state: StateManager, branch: string, force?: boolean): Promise<OperationResult> {
  return queue.enqueueWrite('deleteBranch', async () => {
    const r = await git.exec(['branch', force ? '-D' : '-d', branch]);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function createTag(queue: OperationQueue, git: GitExecutor, state: StateManager, name: string, ref: string, message?: string): Promise<OperationResult> {
  return queue.enqueueWrite('createTag', async () => {
    const args = message ? ['tag', '-a', name, ref, '-m', message] : ['tag', name, ref];
    const r = await git.exec(args);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function deleteTag(queue: OperationQueue, git: GitExecutor, state: StateManager, name: string, remote?: boolean): Promise<OperationResult> {
  return queue.enqueueWrite('deleteTag', async () => {
    const r = await git.exec(['tag', '-d', name]);
    if (r.exitCode !== 0) {
      await state.refreshAll();
      return simpleResult(r.exitCode, r.stderr);
    }
    if (remote) {
      const rr = await git.exec(['push', 'origin', `:refs/tags/${name}`]);
      if (rr.exitCode !== 0) {
        await state.refreshAll();
        return { success: false, error: `Tag deleted locally but failed to delete on remote: ${rr.stderr}`, rollbackAvailable: false };
      }
    }
    await state.refreshAll();
    return simpleResult(0, '');
  });
}

export async function cherryPick(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, hash: string): Promise<OperationResult> {
  return queue.enqueueWrite('cherryPick', async () => {
    const result = await safety.wrapDestructive('cherry-pick', { hash }, async () => {
      const r = await git.exec(['cherry-pick', hash]);
      if (r.exitCode !== 0) throw new GitError(`Cherry-pick failed: ${r.stderr}`, 'cherry-pick', r.exitCode, r.stderr);
    });
    await state.refreshAll();
    return result;
  });
}

export async function revert(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, hash: string): Promise<OperationResult> {
  return queue.enqueueWrite('revert', async () => {
    const result = await safety.wrapDestructive('revert', { hash }, async () => {
      const r = await git.exec(['revert', '--no-edit', hash]);
      if (r.exitCode !== 0) throw new GitError(`Revert failed: ${r.stderr}`, 'revert', r.exitCode, r.stderr);
    });
    await state.refreshAll();
    return result;
  });
}

export async function resetTo(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<OperationResult> {
  return queue.enqueueWrite('reset', async () => {
    const result = await safety.wrapDestructive('reset', { hash, mode }, async () => {
      const r = await git.exec(['reset', `--${mode}`, hash]);
      if (r.exitCode !== 0) throw new GitError(`Reset failed: ${r.stderr}`, 'reset', r.exitCode, r.stderr);
    });
    await state.refreshAll();
    return result;
  });
}

export async function stashApply(queue: OperationQueue, git: GitExecutor, state: StateManager, index: string): Promise<OperationResult> {
  return queue.enqueueWrite('stashApply', async () => {
    const r = await git.exec(['stash', 'apply', index]);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function stashDrop(queue: OperationQueue, git: GitExecutor, state: StateManager, index: string): Promise<OperationResult> {
  return queue.enqueueWrite('stashDrop', async () => {
    const r = await git.exec(['stash', 'drop', index]);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function commit(queue: OperationQueue, git: GitExecutor, state: StateManager, message: string, amend?: boolean): Promise<OperationResult> {
  return queue.enqueueWrite('commit', async () => {
    const args = ['commit', '-m', message];
    if (amend) args.push('--amend');
    const r = await git.exec(args);
    await state.refreshAll();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function stageFile(queue: OperationQueue, git: GitExecutor, state: StateManager, file: string): Promise<OperationResult> {
  return queue.enqueueWrite('stageFile', async () => {
    const r = await git.exec(['add', file]);
    await state.refreshStatusAndNotify();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function stageAll(queue: OperationQueue, git: GitExecutor, state: StateManager, files: string[]): Promise<OperationResult> {
  return queue.enqueueWrite('stageAll', async () => {
    const r = await git.exec(['add', '--', ...files]);
    await state.refreshStatusAndNotify();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function unstageFile(queue: OperationQueue, git: GitExecutor, state: StateManager, file: string): Promise<OperationResult> {
  return queue.enqueueWrite('unstageFile', async () => {
    const r = await git.exec(['reset', 'HEAD', '--', file]);
    await state.refreshStatusAndNotify();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function unstageAll(queue: OperationQueue, git: GitExecutor, state: StateManager, files: string[]): Promise<OperationResult> {
  return queue.enqueueWrite('unstageAll', async () => {
    const r = await git.exec(['reset', 'HEAD', '--', ...files]);
    await state.refreshStatusAndNotify();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function discardFileChanges(queue: OperationQueue, git: GitExecutor, state: StateManager, file: string): Promise<OperationResult> {
  return queue.enqueueWrite('discardFileChanges', async () => {
    const r = await git.exec(['checkout', '--', file]);
    await state.refreshStatusAndNotify();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function cloneRepo(queue: OperationQueue, git: GitExecutor, state: StateManager, url: string, targetPath: string): Promise<OperationResult> {
  return queue.enqueueWrite('clone', async () => {
    const { dirname } = await import('path');
    const parentDir = dirname(targetPath);
    const r = await git.exec(['clone', url, targetPath], { cwd: parentDir, timeout: 120_000 });
    if (r.exitCode !== 0) return simpleResult(r.exitCode, r.stderr);
    state.setRepoPath(targetPath);
    await state.switchRepo(targetPath);
    return simpleResult(0, '');
  });
}

export async function initRepo(queue: OperationQueue, git: GitExecutor, state: StateManager, targetPath: string): Promise<OperationResult> {
  return queue.enqueueWrite('init', async () => {
    const r = await git.exec(['init', targetPath], { cwd: targetPath });
    if (r.exitCode !== 0) return simpleResult(r.exitCode, r.stderr);
    state.setRepoPath(targetPath);
    await state.switchRepo(targetPath);
    return simpleResult(0, '');
  });
}

function buildHunkPatch(file: string, hunk: DiffHunk): string {
  const lines = hunk.lines.map((l: DiffLine) => {
    if (l.type === 'add') return '+' + l.content;
    if (l.type === 'remove') return '-' + l.content;
    return ' ' + l.content;
  });
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    hunk.header,
    ...lines,
    '',
  ].join('\n');
}

function buildLinesPatch(file: string, hunk: DiffHunk, lineIndices: Set<number>): string {
  let oldStart = hunk.oldStart;
  let newStart = hunk.newStart;
  let oldCount = 0;
  let newCount = 0;
  const patchLines: string[] = [];

  hunk.lines.forEach((l, i) => {
    if (l.type === 'context') {
      patchLines.push(' ' + l.content);
      oldCount++;
      newCount++;
    } else if (l.type === 'remove') {
      if (lineIndices.has(i)) {
        patchLines.push('-' + l.content);
        oldCount++;
      } else {
        patchLines.push(' ' + l.content);
        oldCount++;
        newCount++;
      }
    } else if (l.type === 'add') {
      if (lineIndices.has(i)) {
        patchLines.push('+' + l.content);
        newCount++;
      }
    }
  });

  const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    header,
    ...patchLines,
    '',
  ].join('\n');
}

export async function stageHunk(
  queue: OperationQueue, git: GitExecutor, state: StateManager,
  file: string, hunkIndex: number, reverse: boolean,
): Promise<OperationResult> {
  return queue.enqueueWrite('stageHunk', async () => {
    const diffArgs = reverse ? ['diff', '--cached', '--', file] : ['diff', '--', file];
    const diffResult = await git.exec(diffArgs);
    const diffs = parseDiff(diffResult.stdout);
    const fileDiff = diffs.find(d => d.path === file);
    if (!fileDiff || !fileDiff.hunks[hunkIndex]) {
      return { success: false, error: 'Hunk not found', rollbackAvailable: false };
    }

    const patch = buildHunkPatch(file, fileDiff.hunks[hunkIndex]);
    const args = ['apply', '--cached'];
    if (reverse) args.push('--reverse');

    const r = await git.exec(args, { stdin: patch });
    await state.refreshStatusAndNotify();
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function stageLines(
  queue: OperationQueue, git: GitExecutor, state: StateManager,
  file: string, hunkIndex: number, lineIndices: number[], reverse: boolean,
): Promise<OperationResult> {
  return queue.enqueueWrite('stageLines', async () => {
    const diffArgs = reverse ? ['diff', '--cached', '--', file] : ['diff', '--', file];
    const diffResult = await git.exec(diffArgs);
    const diffs = parseDiff(diffResult.stdout);
    const fileDiff = diffs.find(d => d.path === file);
    if (!fileDiff || !fileDiff.hunks[hunkIndex]) {
      return { success: false, error: 'Hunk not found', rollbackAvailable: false };
    }

    const patch = buildLinesPatch(file, fileDiff.hunks[hunkIndex], new Set(lineIndices));
    const args = ['apply', '--cached'];
    if (reverse) args.push('--reverse');

    const r = await git.exec(args, { stdin: patch });
    await state.refreshStatusAndNotify();
    return simpleResult(r.exitCode, r.stderr);
  });
}
