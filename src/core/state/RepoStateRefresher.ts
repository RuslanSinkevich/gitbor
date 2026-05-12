import * as GitParser from '../git/GitParser';
import { loadGraphCache, saveGraphCache } from './GraphCache';
import { perfMark, perfLog } from '../utils/perf';
import { RepoServicesRegistry } from '../services/RepoServicesRegistry';
import { workerPool } from '../workers/WorkerPool';
import { isDangerousRepoRoot } from '../utils/repoPathGuard';
import {
  GIT_LOG_FORMAT,
  GIT_REF_FORMAT,
  GIT_TAG_REF_FORMAT,
  GIT_STASH_FORMAT,
  hashGitStdout,
} from './repoSlice';
import { parseRemoteOnlyHashes } from './remoteOnly';
import type { AppState } from '../git/types';
import type { RepoSlicesStore } from './RepoSlicesStore';

type NotifyFn = () => void;

/**
 * Все async refresh-методы StateManager. Зависит от RepoSlicesStore
 * (читает/пишет slice'ы), от RepoServicesRegistry (получает GitExecutor
 * для конкретного репо) и от notify-callback (информирует EventBus,
 * когда обновился активный репо).
 *
 * Все методы делают token-check для отсечки устаревших inflight операций
 * (если репо переключили или закрыли — все его выполняющиеся refresh'ы
 * обнаружат смену token и тихо выйдут).
 */
export class RepoStateRefresher {
  private static readonly INITIAL_COMMIT_LIMIT = 2000;
  /** Первая быстрая выборка графа — сразу виден топ истории. */
  private static readonly PROGRESSIVE_FIRST_LIMIT = 500;
  /** Полная выборка — «весь граф», догружается в бэкграунде. */
  private static readonly PROGRESSIVE_FULL_LIMIT = 50000;

  constructor(
    private readonly store: RepoSlicesStore,
    private readonly registry: RepoServicesRegistry,
    private readonly notify: NotifyFn,
  ) {}

  private get state(): AppState {
    return this.store.getState();
  }

  /**
   * Полное обновление репо: быстрые запросы (ветки/теги/статус) —
   * сразу notify, граф — прогрессивно, двумя фазами.
   *
   * На вызов из switchRepo/autoOpenRepo даёт первый фрейм UI
   * через ~100–300 мс вместо 2–5 сек на больших репо.
   */
  async refreshAll(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.store.isRepoTracked(target)) return;
    const slice = this.store.getOrCreateSlice(target);
    const startToken = slice.token;
    const endAll = perfMark('refreshAll.total');
    const endFast = perfMark('refreshAll.fast');
    await this.refreshFast(target);
    endFast();
    if (slice.token !== startToken) { endAll(); return; }
    if (target === this.state.repoPath) {
      this.store.mirrorSliceToState(slice);
      this.notify();
    }
    await this.refreshGraphProgressive(target, startToken);
    endAll();
  }

  /** Параллельные дешёвые запросы. Без notify. */
  private async refreshFast(repoPath: string): Promise<void> {
    await Promise.all([
      this.refreshBranches(repoPath),
      this.refreshTags(repoPath),
      this.refreshStashes(repoPath),
      this.refreshRemotes(repoPath),
      this.refreshStatus(repoPath),
    ]);
  }

  /**
   * Двухфазная загрузка графа.
   * Фаза A: 500 коммитов — мгновенная отрисовка.
   * Фаза B: до 50k коммитов — плавное расширение истории.
   * После фазы B сохраняем кэш на диск.
   */
  private async refreshGraphProgressive(repoPath: string, startToken: number): Promise<void> {
    const slice = this.store.getOrCreateSlice(repoPath);
    const endPhaseA = perfMark('refreshGraph.phaseA(500)');
    await this.refreshGraph(RepoStateRefresher.PROGRESSIVE_FIRST_LIMIT, repoPath);
    endPhaseA();
    if (slice.token !== startToken) return;
    if (repoPath === this.state.repoPath) {
      this.store.mirrorSliceToState(slice);
      this.notify();
    }

    if (slice.commits.length >= RepoStateRefresher.PROGRESSIVE_FIRST_LIMIT) {
      const endPhaseB = perfMark('refreshGraph.phaseB(50000)');
      await this.refreshGraph(RepoStateRefresher.PROGRESSIVE_FULL_LIMIT, repoPath);
      endPhaseB();
      if (slice.token !== startToken) return;
      if (repoPath === this.state.repoPath) {
        this.store.mirrorSliceToState(slice);
        this.notify();
      }
    }

    if (slice.token !== startToken) return;
    if (slice.cachedHeadHash && slice.commits.length > 0) {
      void saveGraphCache(
        repoPath,
        slice.cachedHeadHash,
        slice.commits,
        slice.graphLayout,
      );
    }
  }

  async refreshBranches(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.store.isRepoTracked(target)) return;
    const slice = this.store.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;

    try {
      const localResult = await git.exec([
        'for-each-ref', '--format=' + GIT_REF_FORMAT, 'refs/heads/',
      ]);
      if (slice.token !== startToken) return;
      const localBranches = GitParser.parseBranches(localResult.stdout, false);

      const remoteResult = await git.exec([
        'for-each-ref', '--format=' + GIT_REF_FORMAT, 'refs/remotes/',
      ]);
      if (slice.token !== startToken) return;
      const remoteBranches = GitParser.parseBranches(remoteResult.stdout, true);

      slice.branches = [...localBranches, ...remoteBranches];

      const headResult = await git.exec([
        'rev-parse', '--abbrev-ref', 'HEAD',
      ]);
      if (slice.token !== startToken) return;
      slice.currentBranch = headResult.stdout.trim();

      await this.refreshAheadBehind(target);
    } catch {
      if (slice.token !== startToken) return;
      slice.branches = [];
      slice.currentBranch = '';
    }
    if (isActive) {
      this.state.branches = slice.branches;
      this.state.currentBranch = slice.currentBranch;
      this.state.ahead = slice.ahead;
      this.state.behind = slice.behind;
    }
  }

  /** Refresh status and notify listeners (for standalone calls) */
  async refreshStatusAndNotify(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.store.isRepoTracked(target)) return;
    const slice = this.store.getOrCreateSlice(target);
    const startToken = slice.token;
    await this.refreshStatus(target);
    if (slice.token !== startToken) return;
    if (target === this.state.repoPath) this.notify();
  }

  async refreshStatus(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.store.isRepoTracked(target)) return;
    const slice = this.store.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;

    try {
      // Адаптивный режим untracked:
      // - `=all` для нормальных репо: показываем КАЖДЫЙ untracked-файл
      //   отдельной строкой. Без этого новая папка типа `docs/audit/` со
      //   всеми её файлами схлопывается в одну запись `?? docs/audit/`,
      //   и пользователь не видит конкретные файлы (можно случайно
      //   закоммитить лишнее или потерять отслеживание).
      // - `=normal` оставляем только для опасных корней (домашняя папка,
      //   корень диска, системные каталоги), где `=all` упирается в
      //   30s timeout на 440k untracked файлов. Эти кейсы и так отбиты
      //   `repoPathGuard`-ом, но дополнительная страховка не вредит.
      const isDangerous = isDangerousRepoRoot(target).dangerous;
      const untrackedMode = isDangerous ? 'normal' : 'all';
      const statusResult = await git.exec([
        'status', '--porcelain=v1', `--untracked-files=${untrackedMode}`,
      ]);
      if (slice.token !== startToken) return;
      // Парсинг 30+ МБ stdout (`C:\Users\Admin` с 440k untracked) синхронно
      // на main thread замораживал IPC. workerPool офлоадит в worker_threads
      // если stdout большой; для маленьких — inline.
      const parsed = workerPool.parseStatus(statusResult.stdout);
      const allFiles = parsed instanceof Promise ? await parsed : parsed;
      if (slice.token !== startToken) return;
      slice.stagedFiles = allFiles.filter(f => f.staged);
      slice.unstagedFiles = allFiles.filter(f => !f.staged);
      slice.conflicts = allFiles.filter(f => f.status === 'U').map(f => f.path);
    } catch {
      if (slice.token !== startToken) return;
      slice.stagedFiles = [];
      slice.unstagedFiles = [];
      slice.conflicts = [];
    }
    if (isActive) {
      this.state.stagedFiles = slice.stagedFiles;
      this.state.unstagedFiles = slice.unstagedFiles;
      this.state.conflicts = slice.conflicts;
    }
  }

  async refreshGraph(maxCount = 0, repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.store.isRepoTracked(target)) return;
    const slice = this.store.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;

    try {
      const headResult = await git.exec(['rev-parse', 'HEAD']);
      if (slice.token !== startToken) return;
      const headHash = headResult.stdout.trim();

      const effectiveLimit = maxCount > 0 ? maxCount : RepoStateRefresher.INITIAL_COMMIT_LIMIT;

      if (headHash === slice.cachedHeadHash && slice.commits.length > 0 && slice.commits.length >= effectiveLimit) {
        perfLog('refreshGraph.skipped.byHead', { limit: effectiveLimit, have: slice.commits.length });
        return;
      }

      const logArgs = ['log', '--all', '--date-order', `--format=${GIT_LOG_FORMAT}`];
      logArgs.push(`--max-count=${effectiveLimit}`);

      // Большие монорепо (vscode, chromium) с лимитом 50k коммитов могут не
      // уложиться в дефолтные 30s GitExecutor — git log и rev-list по сотням
      // тысяч ref'ов реально занимают 40-90s на холодном диске. Поднимаем
      // потолок до 5 минут, чтобы не ловить timeout-throw → пустой slice →
      // мерцание UI до следующего рефреша.
      const heavyReadTimeout = 5 * 60 * 1000;
      const endGitLog = perfMark(`git log(${effectiveLimit})`);
      const logResult = await git.exec(logArgs, { timeout: heavyReadTimeout });
      endGitLog();
      if (slice.token !== startToken) {
        perfLog('refreshGraph.aborted.afterGitLog', { limit: effectiveLimit });
        return;
      }
      perfLog('git log.stdout', { bytes: logResult.stdout.length });

      const stdoutHash = hashGitStdout(logResult.stdout);
      if (
        headHash === slice.cachedHeadHash &&
        slice.cachedLogHash === stdoutHash &&
        slice.cachedLogLimit === effectiveLimit &&
        slice.commits.length > 0
      ) {
        perfLog('refreshGraph.skipped.byStdoutHash', { limit: effectiveLimit, have: slice.commits.length });
        return;
      }

      slice.cachedHeadHash = headHash;
      slice.cachedLogHash = stdoutHash;
      slice.cachedLogLimit = effectiveLimit;

      // 50k коммитов parseCommits + computeGraphLayout — десятки/сотни мс
      // на main thread, подвисало IPC. Офлоадим в worker для крупных репо.
      const commitsParsed = workerPool.parseCommits(logResult.stdout);
      const commits = commitsParsed instanceof Promise ? await commitsParsed : commitsParsed;
      if (slice.token !== startToken) return;

      // Помечаем коммиты, которые есть только на remote'ах (fetched, но
      // ни в одну локальную ветку ещё не интегрированы). Делаем ДО layout,
      // чтобы GraphNode.isRemoteOnly прокинулся корректно.
      const remoteOnly = await this.computeRemoteOnlySet(target);
      if (slice.token !== startToken) return;
      if (remoteOnly.size > 0) {
        for (const c of commits) {
          if (remoteOnly.has(c.hash)) c.isRemoteOnly = true;
        }
      }

      const layoutParsed = workerPool.computeGraphLayout(commits);
      const layout = layoutParsed instanceof Promise ? await layoutParsed : layoutParsed;
      if (slice.token !== startToken) return;
      slice.commits = commits;
      slice.graphLayout = layout;
    } catch {
      if (slice.token !== startToken) return;
      // Раньше catch обнулял slice.commits и layout. На больших монорепо
      // это давало белый граф при любом транзиентном таймауте git'а
      // (vscode/chromium — 100k+ refs, log может уезжать за дефолтные 30s).
      // Безопаснее оставить старые данные и сбросить только cache-метки,
      // чтобы следующий refresh не пропустил пересчёт по headHash-skip.
      slice.cachedHeadHash = null;
      slice.cachedLogHash = null;
      slice.cachedLogLimit = 0;
    }
    if (isActive) {
      this.state.commits = slice.commits;
      this.state.graphLayout = slice.graphLayout;
    }
  }

  async refreshTags(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.store.isRepoTracked(target)) return;
    const slice = this.store.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;
    try {
      const tagResult = await git.exec([
        'for-each-ref', '--sort=-creatordate', '--format=' + GIT_TAG_REF_FORMAT,
        'refs/tags/',
      ]);
      if (slice.token !== startToken) return;
      slice.tags = GitParser.parseTags(tagResult.stdout);
    } catch {
      if (slice.token !== startToken) return;
      slice.tags = [];
    }
    if (isActive) this.state.tags = slice.tags;
  }

  async refreshStashes(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.store.isRepoTracked(target)) return;
    const slice = this.store.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;
    try {
      const stashResult = await git.exec([
        'stash', 'list', '--format=' + GIT_STASH_FORMAT,
      ]);
      if (slice.token !== startToken) return;
      slice.stashes = GitParser.parseStashes(stashResult.stdout);
    } catch {
      if (slice.token !== startToken) return;
      slice.stashes = [];
    }
    if (isActive) this.state.stashes = slice.stashes;
  }

  async refreshRemotes(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.store.isRepoTracked(target)) return;
    const slice = this.store.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    const isActive = target === this.state.repoPath;
    try {
      const remoteResult = await git.exec(['remote', '-v']);
      if (slice.token !== startToken) return;
      slice.remotes = GitParser.parseRemotes(remoteResult.stdout);
    } catch {
      if (slice.token !== startToken) return;
      slice.remotes = [];
    }
    if (isActive) this.state.remotes = slice.remotes;
  }

  /**
   * Cold-path после switchRepo: пытается загрузить дисковый graph cache,
   * после чего стартует фоновый refreshAll. Вызывается через queueMicrotask
   * из StateManager.switchRepo.
   */
  async runSwitchRepoColdPhase(repoPath: string, startToken: number): Promise<void> {
    const slice = this.store.getOrCreateSlice(repoPath);
    const endLoad = perfMark('switchRepo.loadGraphCache');
    const cache = await loadGraphCache(repoPath);
    endLoad();
    if (slice.token !== startToken) return;
    if (cache) {
      perfLog('switchRepo.cacheHit', { commits: cache.commits.length, nodes: cache.layout.nodes.length });
      slice.commits = cache.commits;
      slice.graphLayout = cache.layout;
      slice.cachedHeadHash = cache.headHash;
      if (repoPath === this.state.repoPath) {
        this.state.commits = slice.commits;
        this.state.graphLayout = slice.graphLayout;
        perfLog('switchRepo.notify#2(cache)');
        this.notify();
      }
    } else {
      perfLog('switchRepo.cacheMiss');
    }
    if (slice.token !== startToken) return;
    this.refreshAll(repoPath).catch(err => {
      perfLog('refreshAll.background.error', { msg: err instanceof Error ? err.message : String(err) });
    });
  }

  invalidateGraphCache(repoPath?: string): void {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    const slice = this.store.getSlice(target);
    if (!slice) return;
    slice.cachedHeadHash = null;
    slice.cachedLogHash = null;
    slice.cachedLogLimit = 0;
  }

  /**
   * Считает множество хэшей коммитов, достижимых из `refs/remotes/*`, но
   * НЕ достижимых из `refs/heads/*`. Используется для маркировки
   * `Commit.isRemoteOnly` — fetched, но не интегрированных в локальную ветку.
   *
   * На больших монорепо `rev-list` может занять 100-500ms. Это в рамках
   * рефреша и редко (только после `refreshGraph`), оптимизация пока не нужна.
   */
  private async computeRemoteOnlySet(repoPath: string): Promise<Set<string>> {
    try {
      const git = this.registry.acquire(repoPath).git;
      // ВАЖНО: голый `refs/remotes` git rev-list трактует как ревизию и
      // падает с "ambiguous argument" (exit=128). Правильно — разворачивать
      // refspec через --glob=refs/remotes/* / --not --glob=refs/heads/*.
      // Это даёт хэши коммитов, достижимых ТОЛЬКО с remote-веток.
      const result = await git.exec([
        'rev-list', '--glob=refs/remotes/*', '--not', '--glob=refs/heads/*',
      ], { timeout: 5 * 60 * 1000 });
      // Если git вернул не-нулевой exit, exec обычно throw'ит — попадём в
      // catch ниже. Если же реализация exec'а заглатывает ошибку и кладёт
      // пустой stdout — parseRemoteOnlyHashes вернёт пустой Set, что тоже
      // безопасно (просто ничего не помечаем dim'ом).
      return parseRemoteOnlyHashes(result.stdout);
    } catch {
      // Нет remote'ов / нет head'ов / ошибка git — в любом случае возвращаем
      // пустое множество, ничего не маркируем (fail-safe).
      return new Set<string>();
    }
  }

  private async refreshAheadBehind(repoPath?: string): Promise<void> {
    const target = repoPath ?? this.state.repoPath;
    if (!target) return;
    if (!this.store.isRepoTracked(target)) return;
    const slice = this.store.getOrCreateSlice(target);
    const git = this.registry.acquire(target).git;
    const startToken = slice.token;
    try {
      const result = await git.exec([
        'rev-list', '--left-right', '--count', 'HEAD...@{upstream}',
      ]);
      if (slice.token !== startToken) return;
      const parts = result.stdout.trim().split('\t');
      slice.ahead = parseInt(parts[0], 10) || 0;
      slice.behind = parseInt(parts[1], 10) || 0;
    } catch {
      if (slice.token !== startToken) return;
      slice.ahead = 0;
      slice.behind = 0;
    }
  }
}
