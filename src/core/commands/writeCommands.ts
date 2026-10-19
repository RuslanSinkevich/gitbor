import { GitExecutor, GitError } from '../git/GitExecutor';
import { parseDiff } from '../git/DiffParser';

import { GitErrorClass, OperationResult, DiffHunk, DiffLine, SuggestedAction } from '../git/types';
import { OperationQueue } from '../safety/OperationQueue';
import { SafetyNet, type WrapOptions } from '../safety/SafetyNet';
import { PreflightChecks } from '../safety/PreflightChecks';
import { StateManager } from '../state/StateManager';
import { GitErrorClassifier } from '../git/GitErrorClassifier';
import { resolveStashDropRef, readStashTip } from '../git/stashRef';
import { mainLogger } from '../utils/Logger';

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

export async function runPreflight(
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
    if (issue.kind === 'cherry_pick_in_progress') {
      actions.push({ kind: 'continue_cherry_pick' });
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

/**
 * Push/fetch: git вернул — UI должен отпустить кнопки и индикатор сразу.
 * Локальный HEAD от push/fetch не меняется (ну, fetch обновляет
 * `refs/remotes/*` но не HEAD), пересчёт полного графа на 50k коммитов
 * **после** sucessful upload — это и есть жалоба «залип после push».
 * Лечим тем же приёмом, что для HEAD_DELTA_OPS: быстрый refresh
 * (ветки/status/ahead-behind/stashes/remotes) — синхронно перед
 * `operationEnd`, тяжёлый граф — fire-and-forget в фоне.
 *
 * Auto-fetch / background sync эту обвязку не используют: они идут
 * через отдельные пути в renderer (`useAutoFetch`), здесь только
 * toolbar/sidebar инициированные операции.
 */
const ASYNC_REFRESH_OPS = new Set(['push', 'fetch']);

interface OpTiming {
  enqueuedAt: number;
  startedAt?: number;
  preflightMs?: number;
  execMs?: number;
}

/**
 * Лог сводки таймингов операции: queue / preflight / exec / refresh / total.
 * Без него регрессии перфа отслеживать невозможно — запросов десятки, а
 * визуально все «быстрые».
 */
function logOpTiming(opName: string, t: OpTiming, refreshMs: number): void {
  if (!t.startedAt) return;
  const queueWaitMs = t.startedAt - t.enqueuedAt;
  const totalMs = Date.now() - t.enqueuedAt;
  mainLogger.info(
    `op ${opName}: queue=${queueWaitMs}ms preflight=${t.preflightMs ?? 0}ms ` +
    `exec=${t.execMs ?? 0}ms refresh=${refreshMs}ms total=${totalMs}ms`,
  );
}

async function gitWrite(
  queue: OperationQueue, state: StateManager, opName: string,
  fn: (timing: OpTiming) => Promise<OperationResult>, refresh: RefreshFn = 'refreshAll',
): Promise<OperationResult> {
  // Захватываем repoPath ДО enqueueWrite — операция должна refresh'ить
  // именно то репо, на котором её запустили, даже если пользователь успел
  // переключиться на другое до старта (или во время) операции.
  const targetRepo = state.getState().repoPath || undefined;
  const timing: OpTiming = { enqueuedAt: Date.now() };
  return queue.enqueueWrite(opName, async () => {
    timing.startedAt = Date.now();
    const result = await fn(timing);
    // Каждая успешная write-операция инвалидирует preflight-кэш —
    // следующая проверка должна увидеть актуальное состояние.
    if (targetRepo) PreflightChecks.invalidateCache(targetRepo);

    const refreshStart = Date.now();
    if (!result.success) {
      if (HEAD_DELTA_OPS.has(opName)) {
        await state.refreshStatusAndNotify(targetRepo);
      }
      logOpTiming(opName, timing, Date.now() - refreshStart);
      return result;
    }
    if (refresh === 'refreshAll' && (HEAD_DELTA_OPS.has(opName) || ASYNC_REFRESH_OPS.has(opName))) {
      await state.refreshAll(targetRepo, { deferHeavy: true });
    } else {
      await state[refresh](targetRepo);
    }
    logOpTiming(opName, timing, Date.now() - refreshStart);
    return result;
  });
}

async function gitExecSimple(
  queue: OperationQueue, git: GitExecutor, state: StateManager,
  opName: string, args: string[], refresh: RefreshFn = 'refreshAll',
): Promise<OperationResult> {
  return gitWrite(queue, state, opName, async (timing) => {
    const execStart = Date.now();
    const r = await git.exec(args);
    timing.execMs = Date.now() - execStart;
    return simpleResult(r.exitCode, r.stderr);
  }, refresh);
}

async function safeWrite(
  queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager,
  opName: string, meta: Record<string, string>, gitArgs: string[], errorPrefix: string,
  wrap: Pick<WrapOptions, 'autoStash' | 'restoreAutoStash'> = {},
): Promise<OperationResult> {
  return gitWrite(queue, state, opName, async (timing) => {
    // Pre-flight: lock, state-files, UU. Не пускаем операцию в SafetyNet
    // если репо точно в нерабочем состоянии — иначе SafetyNet потащит
    // stash на UU и всё развалится так же, как раньше.
    const preStart = Date.now();
    const blocked = await runPreflight(git, opName);
    timing.preflightMs = Date.now() - preStart;
    if (blocked) return blocked;

    const execStart = Date.now();
    const result = await safety.wrapDestructive(
      opName,
      meta,
      async () => {
        const r = await git.exec(gitArgs);
        if (r.exitCode !== 0) throw new GitError(`${errorPrefix}: ${r.stderr}`, opName, r.exitCode, r.stderr);
      },
      { allowedErrorClasses: allowedClassesFor(opName), ...wrap },
    );
    timing.execMs = Date.now() - execStart;
    return result;
  });
}

export type CheckoutMode = 'keep' | 'stash' | 'discard';

/**
 * Checkout с режимом локальных изменений (Fork-стиль):
 *  - `keep`    — checkout без auto-stash. Если git не сможет перенести —
 *                ошибка дойдёт до SafetyDialog как обычно.
 *  - `stash`   — auto-stash через SafetyNet (текущее дефолтное поведение).
 *  - `discard` — `git reset --hard HEAD` перед checkout. Необратимо;
 *                UI должен явно подтвердить намерение.
 */
export async function checkout(
  queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager,
  branch: string, mode: CheckoutMode = 'stash',
): Promise<OperationResult> {
  if (mode === 'discard') {
    return gitWrite(queue, state, 'checkout', async (timing) => {
      const preStart = Date.now();
      const blocked = await runPreflight(git, 'checkout');
      timing.preflightMs = Date.now() - preStart;
      if (blocked) return blocked;

      const execStart = Date.now();
      // reset --hard + checkout — две атомарные команды; rollback не делаем,
      // discard сам по себе явный destructive выбор юзера.
      const resetResult = await git.exec(['reset', '--hard', 'HEAD']);
      if (resetResult.exitCode !== 0) {
        timing.execMs = Date.now() - execStart;
        return simpleResult(resetResult.exitCode, resetResult.stderr);
      }
      const r = await git.exec(['checkout', branch]);
      timing.execMs = Date.now() - execStart;
      return simpleResult(r.exitCode, r.stderr);
    });
  }

  if (mode === 'keep') {
    // Без auto-stash: SafetyNet не оборачиваем, ошибки от git идут напрямую
    // через классификатор → SafetyDialog (`dirty_tree`, `untracked_overwrite`).
    return gitExecSimple(queue, git, state, 'checkout', ['checkout', branch]);
  }

  // mode === 'stash' (default) — текущее поведение через SafetyNet с auto-stash.
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
      args.push(remote || await pickDefaultRemote(git), 'HEAD');
    }
  } else {
    if (remote) args.push(remote);
    if (branch) args.push(`HEAD:${branch}`);
  }
  return gitExecSimple(queue, git, state, 'push', args);
}

/**
 * Remote по умолчанию: `origin`, если он есть (или remote'ов не видно —
 * пусть git сам скажет понятную ошибку), иначе первый из списка. Раньше
 * тут был жёсткий `origin`, и в репо с remote `upstream`/`gitlab` push -u
 * и удаление тега на remote падали.
 */
async function pickDefaultRemote(git: GitExecutor): Promise<string> {
  const out = (await git.exec(['remote'])).stdout.trim();
  const remotes = out ? out.split('\n').map(r => r.trim()).filter(Boolean) : [];
  if (remotes.length === 0 || remotes.includes('origin')) return 'origin';
  return remotes[0];
}

export async function stash(
  queue: OperationQueue, git: GitExecutor, state: StateManager,
  message?: string, includeUntracked?: boolean,
): Promise<OperationResult> {
  const args = ['stash', 'push'];
  // `-u` перед `-m`: забирает новые (untracked) файлы в стэш, иначе они
  // остаются в рабочей копии и «протекают» между ветками при checkout.
  if (includeUntracked) args.push('-u');
  if (message) args.push('-m', message);
  return gitWrite(queue, state, 'stash', async (timing) => {
    const execStart = Date.now();
    // `git stash push` при «нечего откладывать» (например, только untracked
    // без `-u`) пишет «No local changes to save» и выходит с кодом 0 —
    // UI показывал «Изменения отложены», хотя стэш не создан. Сверяем
    // refs/stash до/после, а не stdout: сообщение git локализовано.
    const before = await readStashTip(git);
    const r = await git.exec(args);
    if (r.exitCode !== 0) {
      timing.execMs = Date.now() - execStart;
      return simpleResult(r.exitCode, r.stderr);
    }
    const after = await readStashTip(git);
    timing.execMs = Date.now() - execStart;
    if (after === before) {
      return {
        success: false,
        error: 'No local changes to save',
        errorClass: 'stash_empty',
        severity: 'info',
        rollbackAvailable: false,
      };
    }
    return { success: true, rollbackAvailable: false };
  }, 'refreshAll');
}

/**
 * Стянуть неактивную ЛОКАЛЬНУЮ ветку без переключения на неё.
 *
 * Это НЕ `git pull` (тот мержит в текущую рабочую копию). Правильный приём —
 * `git fetch <remote> <branch>:<branch>`: git обновит локальный ref только
 * при fast-forward. При расхождении git откажет с "non-fast-forward" — мы
 * НЕ обходим это (--force сломал бы историю), а возвращаем понятную ошибку,
 * чтобы UI предложил переключиться и смержить вручную.
 *
 * Remote: явный `remoteOverride` (из UI-модалки) → иначе upstream
 * (`branch.<name>.remote`) → иначе единственный remote / `origin`.
 * `setUpstream` — после успешного FF прописать tracking на `<remote>/<branch>`.
 */
export async function fetchBranchFastForward(
  queue: OperationQueue, git: GitExecutor, state: StateManager, branch: string,
  remoteOverride?: string, setUpstream?: boolean,
): Promise<OperationResult> {
  return gitWrite(queue, state, 'fetch', async (timing) => {
    const execStart = Date.now();

    let remote = remoteOverride?.trim() || '';
    if (!remote) {
      remote = (await git.exec(['config', '--get', `branch.${branch}.remote`])).stdout.trim();
    }
    if (!remote) {
      const remotesOut = (await git.exec(['remote'])).stdout.trim();
      const remotes = remotesOut ? remotesOut.split('\n').map(r => r.trim()).filter(Boolean) : [];
      if (remotes.length === 0) {
        timing.execMs = Date.now() - execStart;
        return {
          success: false,
          rollbackAvailable: false,
          error: 'No remote configured for this repository.',
        };
      }
      remote = remotes.length === 1 ? remotes[0] : (remotes.includes('origin') ? 'origin' : remotes[0]);
    }

    const r = await git.exec(['fetch', remote, `${branch}:${branch}`]);
    timing.execMs = Date.now() - execStart;
    if (r.exitCode !== 0) {
      const classified = GitErrorClassifier.classify(r.stderr);
      // Non-fast-forward — самый частый случай: ветка разошлась с remote.
      const isNonFf = classified.class === 'non_fast_forward' ||
        /non-fast-forward|rejected|diverg/i.test(r.stderr);
      return {
        success: false,
        rollbackAvailable: false,
        errorClass: isNonFf ? 'non_fast_forward' : classified.class,
        // Для non-ff даём понятный текст вместо сырого git-вывода: fast-forward
        // невозможен → нужно переключиться на ветку и смержить/ребейзнуть.
        error: isNonFf
          ? `Cannot fast-forward "${branch}": it has diverged from ${remote}. Switch to the branch and merge or rebase.`
          : r.stderr,
      };
    }

    if (setUpstream) {
      // Tracking после успешного FF — следующие обновления без модалки.
      // Ошибку set-upstream не пробрасываем: сам fetch уже прошёл.
      await git.exec(['branch', '--set-upstream-to', `${remote}/${branch}`, branch]);
    }

    return { success: true, rollbackAvailable: false };
  }, 'refreshAll');
}

/**
 * apply/pop с `--index`: подготовленное возвращается подготовленным (как его
 * откладывали). Если индекс не ложится и git ничего не тронул — без `--index`.
 */
async function stashRestore(git: GitExecutor, verb: 'apply' | 'pop', ref?: string): Promise<OperationResult> {
  const tail = ref ? [ref] : [];
  let r = await git.exec(['stash', verb, '--index', ...tail]);
  if (r.exitCode !== 0 && !(await git.exec(['status', '--porcelain'])).stdout.trim()) {
    r = await git.exec(['stash', verb, ...tail]);
  }
  return simpleResult(r.exitCode, r.stderr);
}

export async function stashPop(queue: OperationQueue, git: GitExecutor, state: StateManager): Promise<OperationResult> {
  return gitWrite(queue, state, 'stashPop', () => stashRestore(git, 'pop'));
}

export async function createBranch(queue: OperationQueue, git: GitExecutor, state: StateManager, name: string, from: string): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'createBranch', ['branch', name, from]);
}

/**
 * Track Remote Branch (как в Fork): создать ЛОКАЛЬНУЮ ветку `localName` с
 * upstream на `<remote>/<remoteBranch>` и переключиться на неё.
 *
 * `git checkout -b <local> --track <remote>/<branch>` — атомарно создаёт
 * ветку, ставит tracking и делает checkout. Переключение ветки трогает
 * рабочую копию, поэтому идём через SafetyNet (auto-stash) + preflight, как
 * обычный checkout, и репортим под opName 'checkout' — refresh/тосты/stale-
 * diff в рендерере уже завязаны на это имя.
 *
 * Если локальная ветка с таким именем уже есть, git вернёт «already exists».
 * В этом случае просто переключаемся на существующую ветку (а не падаем с
 * ошибкой) — это самое дружелюбное поведение для UX «перенести к себе».
 */
export async function trackRemoteBranch(
  queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager,
  remote: string, remoteBranch: string, localName: string,
): Promise<OperationResult> {
  const remoteRef = `${remote}/${remoteBranch}`;
  return gitWrite(queue, state, 'checkout', async (timing) => {
    const preStart = Date.now();
    const blocked = await runPreflight(git, 'checkout');
    timing.preflightMs = Date.now() - preStart;
    if (blocked) return blocked;

    const execStart = Date.now();
    const result = await safety.wrapDestructive(
      'checkout',
      { branch: localName },
      async () => {
        const r = await git.exec(['checkout', '-b', localName, '--track', remoteRef]);
        if (r.exitCode !== 0) {
          if (/already exists/i.test(r.stderr)) {
            const r2 = await git.exec(['checkout', localName]);
            if (r2.exitCode !== 0) {
              throw new GitError(`Track failed: ${r2.stderr}`, 'checkout', r2.exitCode, r2.stderr);
            }
            return;
          }
          throw new GitError(`Track failed: ${r.stderr}`, 'checkout', r.exitCode, r.stderr);
        }
      },
      { allowedErrorClasses: allowedClassesFor('checkout') },
    );
    timing.execMs = Date.now() - execStart;
    return result;
  });
}

export async function setUpstream(queue: OperationQueue, git: GitExecutor, state: StateManager, branch: string, upstream: string): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'setUpstream', ['branch', `--set-upstream-to=${upstream}`, branch]);
}

export async function renameBranch(queue: OperationQueue, git: GitExecutor, state: StateManager, oldName: string, newName: string): Promise<OperationResult> {
  return gitExecSimple(queue, git, state, 'renameBranch', ['branch', '-m', oldName, newName]);
}

/**
 * Удалить локальную ветку; с `deleteRemote` — сначала её upstream на сервере
 * (`git push <remote> --delete <branch>`), как в Fork. Сервер первым: если он
 * откажет, локальная ветка останется и удаление можно повторить из UI.
 * Upstream берём из branch.<name>.remote/merge — после `branch -D` его уже нет.
 */
export async function deleteBranch(
  queue: OperationQueue, git: GitExecutor, state: StateManager, branch: string, force?: boolean, deleteRemote?: boolean,
): Promise<OperationResult> {
  if (!deleteRemote) {
    return gitExecSimple(queue, git, state, 'deleteBranch', ['branch', force ? '-D' : '-d', branch]);
  }
  return gitWrite(queue, state, 'deleteBranch', async () => {
    const remote = (await git.exec(['config', '--get', `branch.${branch}.remote`])).stdout.trim();
    const merge = (await git.exec(['config', '--get', `branch.${branch}.merge`])).stdout.trim();
    const remoteBranch = merge.replace(/^refs\/heads\//, '');
    if (!remote || remote === '.' || !remoteBranch) {
      return { success: false, error: `Branch "${branch}" has no upstream on a remote — nothing to delete there.`, rollbackAvailable: false };
    }
    const rr = await git.exec(['push', remote, '--delete', remoteBranch]);
    if (rr.exitCode !== 0) return simpleResult(rr.exitCode, rr.stderr);
    const r = await git.exec(['branch', force ? '-D' : '-d', branch]);
    if (r.exitCode !== 0) {
      return { success: false, error: `Deleted ${remote}/${remoteBranch} on the remote, but the local branch was not deleted: ${r.stderr}`, rollbackAvailable: false };
    }
    return simpleResult(0, '');
  });
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
      const rr = await git.exec(['push', await pickDefaultRemote(git), `:refs/tags/${name}`]);
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

/**
 * Batch cherry-pick через нативный git-секвенсер:
 * `git cherry-pick --empty=drop <h1..hN>` применяет по одному, на конфликте
 * останавливается с `CHERRY_PICK_HEAD` + `.git/sequencer/`. Порядок хэшей —
 * старые→новые (сортирует renderer). Конфликт — нормальный исход
 * (`allowedErrorClasses:['conflict']`), UI откроет merge-editor.
 *
 * `--empty=drop` (git ≥ 2.45) пропускает коммиты, ставшие пустыми. Старый git
 * не знает флаг и падает с parse-ошибкой — тогда повторяем без него.
 */
export async function cherryPickMany(
  queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, hashes: string[],
): Promise<OperationResult> {
  if (hashes.length === 0) return { success: true, rollbackAvailable: false };
  const meta: Record<string, string> = { count: String(hashes.length) };
  return gitWrite(queue, state, 'cherry-pick', async (timing) => {
    const preStart = Date.now();
    const blocked = await runPreflight(git, 'cherry-pick');
    timing.preflightMs = Date.now() - preStart;
    if (blocked) return blocked;

    const execStart = Date.now();
    const result = await safety.wrapDestructive(
      'cherry-pick',
      meta,
      async () => {
        let r = await git.exec(['cherry-pick', '--empty=drop', ...hashes]);
        // Старый git (<2.45) не знает `--empty`: git печатает usage/parse-ошибку
        // (не конфликт) — повторяем без флага. Конфликт же пропускаем дальше,
        // его обработает allowedErrorClasses.
        if (r.exitCode !== 0 && /unknown option|error: option .*empty|usage: git cherry-pick/i.test(r.stderr)) {
          r = await git.exec(['cherry-pick', ...hashes]);
        }
        if (r.exitCode !== 0) throw new GitError(`Cherry-pick failed: ${r.stderr}`, 'cherry-pick', r.exitCode, r.stderr);
      },
      { allowedErrorClasses: allowedClassesFor('cherry-pick') },
    );
    timing.execMs = Date.now() - execStart;
    return result;
  });
}

/**
 * Продолжить остановленную cherry-pick-серию: `git cherry-pick --continue`.
 * НЕ через safeWrite (auto-stash не нужен — конфликт уже разрешён в индексе).
 * `GIT_EDITOR=true` — сообщение коммита уже готово, редактор не нужен.
 * Следующий pick может снова конфликтовать: это не ошибка, возвращаем success
 * и даём UI перечитать mergeState (баннер покажет остаток серии).
 */
export async function cherryPickContinue(queue: OperationQueue, git: GitExecutor, state: StateManager): Promise<OperationResult> {
  return gitWrite(queue, state, 'cherry-pick', async (timing) => {
    const execStart = Date.now();
    const r = await git.exec(['cherry-pick', '--continue'], { env: { GIT_EDITOR: 'true' } });
    timing.execMs = Date.now() - execStart;
    if (r.exitCode === 0) return { success: true, rollbackAvailable: false };
    if (GitErrorClassifier.classify(r.stderr).class === 'conflict') {
      return { success: true, rollbackAvailable: false };
    }
    return simpleResult(r.exitCode, r.stderr);
  });
}

/**
 * Пропустить текущий коммит cherry-pick-серии: `git cherry-pick --skip`.
 * Как и continue, следующий pick может конфликтовать — конфликт не ошибка.
 */
export async function cherryPickSkip(queue: OperationQueue, git: GitExecutor, state: StateManager): Promise<OperationResult> {
  return gitWrite(queue, state, 'cherry-pick', async (timing) => {
    const execStart = Date.now();
    const r = await git.exec(['cherry-pick', '--skip']);
    timing.execMs = Date.now() - execStart;
    if (r.exitCode === 0) return { success: true, rollbackAvailable: false };
    if (GitErrorClassifier.classify(r.stderr).class === 'conflict') {
      return { success: true, rollbackAvailable: false };
    }
    return simpleResult(r.exitCode, r.stderr);
  });
}

export async function revert(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, hash: string, mainline?: number): Promise<OperationResult> {
  const args = ['revert', '--no-edit'];
  if (mainline && mainline > 0) args.push('-m', String(mainline));
  args.push(hash);
  const meta: Record<string, string> = { hash };
  if (mainline) meta.mainline = String(mainline);
  return safeWrite(queue, git, safety, state, 'revert', meta, args, 'Revert failed');
}

/**
 * Soft/mixed рабочую копию не трогают — auto-stash им не нужен (а его
 * возврат ещё и терял staging). Hard выбрасывает незакоммиченное: копию
 * откладываем в auto-stash («Безопасность»), но обратно НЕ применяем —
 * иначе «сброс» молча возвращал правки, да ещё с конфликтом.
 */
export async function resetTo(queue: OperationQueue, git: GitExecutor, safety: SafetyNet, state: StateManager, hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<OperationResult> {
  return safeWrite(queue, git, safety, state, 'reset', { hash, mode }, ['reset', `--${mode}`, hash], 'Reset failed',
    { autoStash: mode === 'hard', restoreAutoStash: false });
}

export async function stashApply(queue: OperationQueue, git: GitExecutor, state: StateManager, index: string): Promise<OperationResult> {
  return gitWrite(queue, state, 'stashApply', () => stashRestore(git, 'apply', index));
}

export async function stashDrop(queue: OperationQueue, git: GitExecutor, state: StateManager, index: string): Promise<OperationResult> {
  return gitWrite(queue, state, 'stashDrop', async (timing) => {
    const execStart = Date.now();
    // Hash (из SafetyNet / recovery) → stash@{n}: `git stash drop` hash не принимает.
    const dropRef = await resolveStashDropRef(git, index);
    if (!dropRef) {
      timing.execMs = Date.now() - execStart;
      return { success: false, error: `stash ${index} not found`, rollbackAvailable: false };
    }
    const r = await git.exec(['stash', 'drop', dropRef]);
    timing.execMs = Date.now() - execStart;
    return simpleResult(r.exitCode, r.stderr);
  }, 'refreshAll');
}

export async function commit(queue: OperationQueue, git: GitExecutor, state: StateManager, message: string, amend?: boolean): Promise<OperationResult> {
  const args = ['commit', '-m', message];
  if (amend) args.push('--amend');
  // Без preflight по задаче safety-relaxation: commit терпит fresh lock
  // (если он чужой — упадёт, классификатор пометит как lock_held и юзер
  // увидит SafetyDialog; чаще же это наш только что отпустивший git).
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

/** Строка патча; за строкой без `\n` в конце файла — маркер, иначе git apply не сходится. */
function patchLine(prefix: string, l: DiffLine): string {
  return l.noNewlineAtEnd ? `${prefix}${l.content}\n\\ No newline at end of file` : prefix + l.content;
}

function buildHunkPatch(file: string, hunk: DiffHunk): string {
  const lines = hunk.lines.map((l: DiffLine) => {
    if (l.type === 'add') return patchLine('+', l);
    if (l.type === 'remove') return patchLine('-', l);
    return patchLine(' ', l);
  });
  return [`--- a/${file}`, `+++ b/${file}`, hunk.header, ...lines, ''].join('\n');
}

/**
 * Патч из выбранных строк ханка. Невыбранные строки должны остаться как в
 * той стороне, к которой патч применяется:
 *  - stage (forward, к индексу = old-сторона): невыбранное удаление — контекст,
 *    невыбранное добавление — выкидываем;
 *  - unstage (`--reverse`, к индексу = new-сторона): наоборот — невыбранное
 *    добавление (оно уже в индексе) — контекст, невыбранное удаление — выкидываем.
 * Раньше reverse строился как forward, и `git apply` падал на смешанных ханках.
 */
function buildLinesPatch(file: string, hunk: DiffHunk, lineIndices: Set<number>, reverse = false): string {
  let oldCount = 0, newCount = 0;
  const patchLines: string[] = [];
  const keepAsContext = reverse ? 'add' : 'remove';

  hunk.lines.forEach((l, i) => {
    if (l.type === 'context') {
      patchLines.push(patchLine(' ', l)); oldCount++; newCount++;
      return;
    }
    if (lineIndices.has(i)) {
      if (l.type === 'remove') { patchLines.push(patchLine('-', l)); oldCount++; }
      else { patchLines.push(patchLine('+', l)); newCount++; }
    } else if (l.type === keepAsContext) {
      patchLines.push(patchLine(' ', l)); oldCount++; newCount++;
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

/**
 * Применить reverse-patch к РАБОЧЕЙ КОПИИ (без `--cached`). Используется
 * для discard конкретного hunk: соседние hunks файла не трогаем, в
 * отличие от `checkout -- <file>`, который откатывает весь файл.
 *
 * `--unidiff-zero` НЕ нужен — мы строим патч с фактическим контекстом.
 * Если апликация падает (context mismatch — другой эфемерный edit
 * пользователя), просто возвращаем ошибку. SafetyDialog покажет.
 */
async function applyPatchWorktree(git: GitExecutor, state: StateManager, patch: string): Promise<OperationResult> {
  const r = await git.exec(['apply', '--reverse'], { stdin: patch });
  await state.refreshStatusAndNotify();
  return simpleResult(r.exitCode, r.stderr);
}

/**
 * Новый (untracked) файл: `git diff` его не видит, и ханк «не найден».
 * `git add -N` (intent-to-add) кладёт в индекс пустую запись — diff
 * показывает файл целиком одним ханком, и патч применяется как обычно.
 * Возвращает true, если пометили: при неудаче пометку нужно снять.
 */
async function markUntrackedForStaging(git: GitExecutor, file: string): Promise<boolean> {
  const r = await git.exec(['ls-files', '--others', '--exclude-standard', '--', file]);
  if (r.exitCode !== 0 || !r.stdout.trim()) return false;
  const add = await git.exec(['add', '--intent-to-add', '--', file]);
  return add.exitCode === 0;
}

async function stagePatchFor(
  git: GitExecutor, state: StateManager, file: string, hunkIndex: number, reverse: boolean,
  build: (hunk: DiffHunk) => string,
): Promise<OperationResult> {
  const marked = !reverse && await markUntrackedForStaging(git, file);
  const hunk = await getDiffHunk(git, file, hunkIndex, reverse);
  const result: OperationResult = hunk
    ? await applyPatch(git, state, build(hunk), reverse)
    : { success: false, error: 'Hunk not found', rollbackAvailable: false };
  // Не получилось — вернуть файл в untracked, а не оставлять пустую пометку.
  if (marked && !result.success) {
    await git.exec(['reset', '-q', '--', file]);
    await state.refreshStatusAndNotify();
  }
  return result;
}

export async function stageHunk(
  queue: OperationQueue, git: GitExecutor, state: StateManager,
  file: string, hunkIndex: number, reverse: boolean,
): Promise<OperationResult> {
  return queue.enqueueWrite('stageHunk', () =>
    stagePatchFor(git, state, file, hunkIndex, reverse, (hunk) => buildHunkPatch(file, hunk)));
}

export async function stageLines(
  queue: OperationQueue, git: GitExecutor, state: StateManager,
  file: string, hunkIndex: number, lineIndices: number[], reverse: boolean,
): Promise<OperationResult> {
  return queue.enqueueWrite('stageLines', () =>
    stagePatchFor(git, state, file, hunkIndex, reverse, (hunk) => buildLinesPatch(file, hunk, new Set(lineIndices), reverse)));
}

/**
 * Discard отдельного hunk из unstaged diff'а. Берём патч исходного
 * (рабочая копия) diff'а и применяем его reverse к worktree — этот hunk
 * откатывается, остальные сохраняются. Discard на staged hunk
 * НЕ поддерживается (вне scope: для staged логично сначала unstage).
 */
export async function discardHunk(
  queue: OperationQueue, git: GitExecutor, state: StateManager,
  file: string, hunkIndex: number,
): Promise<OperationResult> {
  return queue.enqueueWrite('discardHunk', async () => {
    const hunk = await getDiffHunk(git, file, hunkIndex, false);
    if (!hunk) return { success: false, error: 'Hunk not found', rollbackAvailable: false };
    return applyPatchWorktree(git, state, buildHunkPatch(file, hunk));
  });
}
