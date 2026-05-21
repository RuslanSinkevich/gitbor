import { GitExecutor, GitError } from '../git/GitExecutor';
import { parseDiff } from '../git/DiffParser';

import { GitErrorClass, OperationResult, DiffHunk, DiffLine, SuggestedAction } from '../git/types';
import { OperationQueue } from '../safety/OperationQueue';
import { SafetyNet } from '../safety/SafetyNet';
import { PreflightChecks } from '../safety/PreflightChecks';
import { StateManager } from '../state/StateManager';
import { GitErrorClassifier } from '../git/GitErrorClassifier';

function simpleResult(exitCode: number, stderr: string): OperationResult {
  if (exitCode === 0) return { success: true, rollbackAvailable: false };
  // Классифицируем даже у простых команд — UI получит errorClass для toast/dialog.
  const classified = GitErrorClassifier.classify(stderr);
  return {
    success: false,
    error: stderr,
    rollbackAvailable: false,
    errorClass: classified.class,
  };
}

/**
 * Операции, при которых конфликт от git — нормальный исход (не ошибка),
 * UI открывает merge editor. Пробрасываем в SafetyNet через
 * `allowedErrorClasses`, чтобы wrapDestructive не делал rollback.
 */
const CONFLICTABLE_OPS = new Set(['merge', 'pull', 'rebase', 'cherry-pick', 'revert']);

function allowedClassesFor(opName: string): GitErrorClass[] {
  if (CONFLICTABLE_OPS.has(opName)) return ['conflict'];
  return [];
}

async function runPreflight(
  git: GitExecutor,
  opName: string,
): Promise<OperationResult | null> {
  const repoPath = git.getCwd();
  const preflight = new PreflightChecks(git);
  const report = await preflight.check(repoPath, opName);
  if (report.ok) return null;

  const actions: SuggestedAction[] = [];
  for (const issue of report.issues) {
    if (issue.kind === 'lock_held_fresh') actions.push({ kind: 'remove_lock' });
    if (issue.kind === 'merge_in_progress') {
      actions.push({ kind: 'continue_merge' });
      actions.push({ kind: 'abort_merge' });
    }
    if (issue.kind === 'rebase_in_progress') {
      actions.push({ kind: 'abort_rebase' });
      actions.push({ kind: 'manual_continue' });
    }
    if (issue.kind === 'unmerged_paths') {
      actions.push({ kind: 'continue_merge' });
      actions.push({ kind: 'abort_merge' });
    }
  }
  // Уникальный набор по kind, чтобы не дублировать кнопки.
  const seen = new Set<string>();
  const uniq = actions.filter(a => {
    if (seen.has(a.kind)) return false;
    seen.add(a.kind);
    return true;
  });
  uniq.push({ kind: 'cancel' });

  return {
    success: false,
    rollbackAvailable: false,
    errorClass: 'preflight_blocked',
    error: report.issues.map(i => i.description).join('; '),
    preflightIssues: report.issues,
    suggestedActions: uniq,
  };
}

type RefreshFn = 'refreshAll' | 'refreshStatusAndNotify';

/**
 * Операции, которые обычно меняют HEAD на 1 коммит (+ ребейс — несколько,
 * но всё равно немного). Полный refreshGraph (50k) ради дельты в N коммитов
 * избыточен и блокирует UI на монорепо. После них `deferHeavy=true`:
 * быстрая часть рефреша + первые 500 коммитов сразу, полный граф — фоном.
 * См. `docs/performance/refresh-investigation.md`.
 */
const HEAD_DELTA_OPS = new Set([
  'commit', 'merge', 'cherry-pick', 'revert', 'pull', 'rebase', 'reset', 'restoreReflog',
]);

async function gitWrite(
  queue: OperationQueue, state: StateManager, opName: string,
  fn: () => Promise<OperationResult>, refresh: RefreshFn = 'refreshAll',
): Promise<OperationResult> {
  // Захватываем repoPath ДО enqueueWrite — операция должна refresh'ить
  // именно то репо, на котором её запустили, даже если пользователь успел
  // переключиться на другое до старта (или во время) операции.
  const targetRepo = state.getState().repoPath || undefined;
  return queue.enqueueWrite(opName, async () => {
    const result = await fn();
    if (refresh === 'refreshAll' && HEAD_DELTA_OPS.has(opName)) {
      await state.refreshAll(targetRepo, { deferHeavy: true });
    } else {
      await state[refresh](targetRepo);
    }
    return result;
  });
}

async function gitExecSimple(
  queue: OperationQueue, git: GitExecutor, state: StateManager,
  opName: string, args: string[], refresh: RefreshFn = 'refreshAll',
): Promise<OperationResult> {
  return gitWrite(queue, state, opName, async () => {
    const r = await git.exec(args);
    return simpleResult(r.exitCode, r.stderr);
  }, refresh);
}

async function safeWrite(
  queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager,
  opName: string, meta: Record<string, string>, gitArgs: string[], errorPrefix: string,
): Promise<OperationResult> {
  return gitWrite(queue, state, opName, async () => {
    // Pre-flight: lock, state-files, UU. Не пускаем операцию в SafetyNet
    // если репо точно в нерабочем состоянии — иначе SafetyNet потащит
    // stash на UU и всё развалится так же, как раньше.
    const blocked = await runPreflight(git, opName);
    if (blocked) return blocked;

    return safety.wrapDestructive(
      opName,
      meta,
      async () => {
        const r = await git.exec(gitArgs);
        if (r.exitCode !== 0) throw new GitError(`${errorPrefix}: ${r.stderr}`, opName, r.exitCode, r.stderr);
      },
      { allowedErrorClasses: allowedClassesFor(opName) },
    );
  });
}

export async function checkout(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, branch: string): Promise<OperationResult> {
  return safeWrite(queue, git, safety, state, 'checkout', { branch }, ['checkout', branch], 'Checkout failed');
}

export async function fetch(queue: OperationQueue, git: GitExecutor, state: StateManager, remote?: string): Promise<OperationResult> {
  const args = remote ? ['fetch', '--prune', remote] : ['fetch', '--all', '--prune'];
  return gitExecSimple(queue, git, state, 'fetch', args);
}

export async function pull(
  queue: OperationQueue,
  git: GitExecutor,
  safety: SafetyNet,
  state: StateManager,
  rebase?: boolean,
  remote?: string,
  branch?: string,
  autostash?: boolean,
): Promise<OperationResult> {
  const args: string[] = ['pull'];
  if (rebase) args.push('--rebase');
  if (autostash) args.push('--autostash');
  if (remote) args.push(remote);
  if (branch) args.push(branch);
  return safeWrite(queue, git, safety, state, 'pull', {}, args, 'Pull failed');
}

export async function push(
  queue: OperationQueue,
  git: GitExecutor,
  state: StateManager,
  force?: boolean,
  setUpstream?: boolean,
  remote?: string,
  branch?: string,
): Promise<OperationResult> {
  const args = ['push'];
  if (force) args.push('--force-with-lease');
  if (setUpstream) {
    args.push('-u');
    if (remote && branch) {
      args.push(remote, `HEAD:${branch}`);
    } else {
      args.push('origin', 'HEAD');
    }
  } else {
    if (remote) args.push(remote);
    if (branch) args.push(`HEAD:${branch}`);
  }
  return gitExecSimple(queue, git, state, 'push', args);
}

export async function stash(queue: OperationQueue, git: GitExecutor, state: StateManager, message?: string): Promise<OperationResult> {
  const args = ['stash', 'push'];
  if (message) args.push('-m', message);
  return gitExecSimple(queue, git, state, 'stash', args);
}

export async function stashPop(queue: OperationQueue, git: GitExecutor, state: StateManager): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'stashPop', ['stash', 'pop']);
}

export async function createBranch(queue: OperationQueue, git: GitExecutor, state: StateManager, name: string, from: string): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'createBranch', ['branch', name, from]);
}

export async function renameBranch(queue: OperationQueue, git: GitExecutor, state: StateManager, oldName: string, newName: string): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'renameBranch', ['branch', '-m', oldName, newName]);
}

export async function deleteBranch(queue: OperationQueue, git: GitExecutor, state: StateManager, branch: string, force?: boolean): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'deleteBranch', ['branch', force ? '-D' : '-d', branch]);
}

export async function createTag(queue: OperationQueue, git: GitExecutor, state: StateManager, name: string, ref: string, message?: string): Promise<OperationResult> {
  const args = message ? ['tag', '-a', name, ref, '-m', message] : ['tag', name, ref];
  return gitExecSimple(queue, git, state, 'createTag', args);
}

export async function deleteTag(queue: OperationQueue, git: GitExecutor, state: StateManager, name: string, remote?: boolean): Promise<OperationResult> {
  return gitWrite(queue, state, 'deleteTag', async () => {
    const r = await git.exec(['tag', '-d', name]);
    if (r.exitCode !== 0) return simpleResult(r.exitCode, r.stderr);
    if (remote) {
      const rr = await git.exec(['push', 'origin', `:refs/tags/${name}`]);
      if (rr.exitCode !== 0) return { success: false, error: `Tag deleted locally but failed to delete on remote: ${rr.stderr}`, rollbackAvailable: false };
    }
    return simpleResult(0, '');
  });
}

export async function cherryPick(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, hash: string, mainline?: number): Promise<OperationResult> {
  const args = ['cherry-pick'];
  if (mainline && mainline > 0) args.push('-m', String(mainline));
  args.push(hash);
  const meta: Record<string, string> = { hash };
  if (mainline) meta.mainline = String(mainline);
  return safeWrite(queue, git, safety, state, 'cherry-pick', meta, args, 'Cherry-pick failed');
}

export async function revert(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, hash: string, mainline?: number): Promise<OperationResult> {
  const args = ['revert', '--no-edit'];
  if (mainline && mainline > 0) args.push('-m', String(mainline));
  args.push(hash);
  const meta: Record<string, string> = { hash };
  if (mainline) meta.mainline = String(mainline);
  return safeWrite(queue, git, safety, state, 'revert', meta, args, 'Revert failed');
}

export async function resetTo(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<OperationResult> {
  return safeWrite(queue, git, safety, state, 'reset', { hash, mode }, ['reset', `--${mode}`, hash], 'Reset failed');
}

export async function stashApply(queue: OperationQueue, git: GitExecutor, state: StateManager, index: string): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'stashApply', ['stash', 'apply', index]);
}

export async function stashDrop(queue: OperationQueue, git: GitExecutor, state: StateManager, index: string): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'stashDrop', ['stash', 'drop', index]);
}

export async function commit(queue: OperationQueue, git: GitExecutor, state: StateManager, message: string, amend?: boolean): Promise<OperationResult> {
  const args = ['commit', '-m', message];
  if (amend) args.push('--amend');
  return gitExecSimple(queue, git, state, 'commit', args);
}

export async function stageFile(queue: OperationQueue, git: GitExecutor, state: StateManager, file: string): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'stageFile', ['add', '--', file], 'refreshStatusAndNotify');
}

export async function stageAll(queue: OperationQueue, git: GitExecutor, state: StateManager, files: string[]): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'stageAll', ['add', '--', ...files], 'refreshStatusAndNotify');
}

export async function unstageFile(queue: OperationQueue, git: GitExecutor, state: StateManager, file: string): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'unstageFile', ['reset', 'HEAD', '--', file], 'refreshStatusAndNotify');
}

export async function unstageAll(queue: OperationQueue, git: GitExecutor, state: StateManager, files: string[]): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'unstageAll', ['reset', 'HEAD', '--', ...files], 'refreshStatusAndNotify');
}

export async function discardFileChanges(queue: OperationQueue, git: GitExecutor, state: StateManager, file: string): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'discardFileChanges', ['checkout', '--', file], 'refreshStatusAndNotify');
}

export async function discardFiles(queue: OperationQueue, git: GitExecutor, state: StateManager, files: string[]): Promise<OperationResult> {
  if (files.length === 0) return { success: true, rollbackAvailable: false };
  return gitExecSimple(queue, git, state, 'discardFiles', ['checkout', '--', ...files], 'refreshStatusAndNotify');
}

export async function cloneRepo(queue: OperationQueue, git: GitExecutor, state: StateManager, url: string, targetPath: string): Promise<OperationResult> {
  return gitWrite(queue, state, 'clone', async () => {
    const { dirname } = await import('path');
    const parentDir = dirname(targetPath);
    const r = await git.exec(['clone', url, targetPath], { cwd: parentDir });
    if (r.exitCode !== 0) return simpleResult(r.exitCode, r.stderr);
    state.setRepoPath(targetPath);
    await state.switchRepo(targetPath);
    return simpleResult(0, '');
  });
}

export async function initRepo(queue: OperationQueue, git: GitExecutor, state: StateManager, targetPath: string): Promise<OperationResult> {
  return gitWrite(queue, state, 'init', async () => {
    const { dirname } = await import('path');
    const parentDir = dirname(targetPath);
    const r = await git.exec(['init', targetPath], { cwd: parentDir });
    if (r.exitCode !== 0) return simpleResult(r.exitCode, r.stderr);
    state.setRepoPath(targetPath);
    await state.switchRepo(targetPath);
    return simpleResult(0, '');
  });
}

/* ─── Hunk/line staging (shared diff fetch) ─── */

function buildHunkPatch(file: string, hunk: DiffHunk): string {
  const lines = hunk.lines.map((l: DiffLine) => {
    if (l.type === 'add') return '+' + l.content;
    if (l.type === 'remove') return '-' + l.content;
    return ' ' + l.content;
  });
  return [`--- a/${file}`, `+++ b/${file}`, hunk.header, ...lines, ''].join('\n');
}

function buildLinesPatch(file: string, hunk: DiffHunk, lineIndices: Set<number>): string {
  let oldCount = 0, newCount = 0;
  const patchLines: string[] = [];

  hunk.lines.forEach((l, i) => {
    if (l.type === 'context') {
      patchLines.push(' ' + l.content); oldCount++; newCount++;
    } else if (l.type === 'remove') {
      if (lineIndices.has(i)) { patchLines.push('-' + l.content); oldCount++; }
      else { patchLines.push(' ' + l.content); oldCount++; newCount++; }
    } else if (l.type === 'add') {
      if (lineIndices.has(i)) { patchLines.push('+' + l.content); newCount++; }
    }
  });

  const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
  return [`--- a/${file}`, `+++ b/${file}`, header, ...patchLines, ''].join('\n');
}

async function getDiffHunk(git: GitExecutor, file: string, hunkIndex: number, reverse: boolean) {
  const diffArgs = reverse ? ['diff', '--cached', '--', file] : ['diff', '--', file];
  const diffResult = await git.exec(diffArgs);
  const diffs = parseDiff(diffResult.stdout);
  const fileDiff = diffs.find(d => d.path === file);
  return fileDiff?.hunks[hunkIndex] ?? null;
}

async function applyPatch(git: GitExecutor, state: StateManager, patch: string, reverse: boolean): Promise<OperationResult> {
  const args = ['apply', '--cached'];
  if (reverse) args.push('--reverse');
  const r = await git.exec(args, { stdin: patch });
  await state.refreshStatusAndNotify();
  return simpleResult(r.exitCode, r.stderr);
}

export async function stageHunk(
  queue: OperationQueue, git: GitExecutor, state: StateManager,
  file: string, hunkIndex: number, reverse: boolean,
): Promise<OperationResult> {
  return queue.enqueueWrite('stageHunk', async () => {
    const hunk = await getDiffHunk(git, file, hunkIndex, reverse);
    if (!hunk) return { success: false, error: 'Hunk not found', rollbackAvailable: false };
    return applyPatch(git, state, buildHunkPatch(file, hunk), reverse);
  });
}

export async function stageLines(
  queue: OperationQueue, git: GitExecutor, state: StateManager,
  file: string, hunkIndex: number, lineIndices: number[], reverse: boolean,
): Promise<OperationResult> {
  return queue.enqueueWrite('stageLines', async () => {
    const hunk = await getDiffHunk(git, file, hunkIndex, reverse);
    if (!hunk) return { success: false, error: 'Hunk not found', rollbackAvailable: false };
    return applyPatch(git, state, buildLinesPatch(file, hunk, new Set(lineIndices)), reverse);
  });
}
