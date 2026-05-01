import { GitExecutor } from '../git/GitExecutor';
import { OperationQueue } from '../safety/OperationQueue';
import { SafetyNet } from '../safety/SafetyNet';

/**
 * Изолированный набор сервисов одного репозитория. cwd у `GitExecutor`
 * фиксирован — `setCwd` не используется снаружи, чтобы не было ситуации
 * «один executor таскают между репо».
 */
export interface RepoServices {
  readonly repoPath: string;
  readonly git: GitExecutor;
  readonly queue: OperationQueue;
  readonly safety: SafetyNet;
}

/**
 * Реестр per-repo сервисов. Каждый открытый репозиторий получает свой
 * `GitExecutor`, свою `OperationQueue` и свой `SafetyNet`. Это разрывает
 * глобальную сериализацию: длинный `git pull` на репо A больше не
 * блокирует операции на репо B.
 *
 * Реестр lazy: services создаются по `acquire(repoPath)` при первом
 * обращении и живут до явного `release(repoPath)` (обычно — закрытие репо
 * или dispose реестра при выходе).
 */
export class RepoServicesRegistry {
  private readonly map = new Map<string, RepoServices>();
  private readonly listeners = new Set<(running: boolean, op: string | null) => void>();
  /**
   * Bootstrap-сервисы для операций без открытого репо (clone, init).
   * cwd у `git` не привязан ни к чему конкретному — каждая команда в этом
   * GitExecutor'е должна явно передавать `cwd` через options.
   */
  private bootstrapCache: RepoServices | null = null;

  has(repoPath: string): boolean {
    return this.map.has(repoPath);
  }

  bootstrap(): RepoServices {
    if (this.bootstrapCache) return this.bootstrapCache;
    const git = new GitExecutor(process.cwd());
    const queue = new OperationQueue();
    const safety = new SafetyNet(git);
    queue.onStatusChange((running, op) => {
      for (const l of this.listeners) l(running, op);
    });
    this.bootstrapCache = { repoPath: '', git, queue, safety };
    return this.bootstrapCache;
  }

  /** Получить (создать при необходимости) per-repo сервисы. */
  acquire(repoPath: string): RepoServices {
    let svc = this.map.get(repoPath);
    if (svc) return svc;
    const git = new GitExecutor(repoPath);
    const queue = new OperationQueue();
    const safety = new SafetyNet(git);
    queue.onStatusChange((running, op) => {
      // Транслируем агрегированно: внешним подписчикам сообщаем «кто-то
      // что-то делает». При последующем переходе на per-repo события (этап 2)
      // здесь будет приходить repoPath тоже.
      for (const l of this.listeners) l(running, op);
    });
    svc = { repoPath, git, queue, safety };
    this.map.set(repoPath, svc);
    return svc;
  }

  get(repoPath: string): RepoServices | undefined {
    return this.map.get(repoPath);
  }

  /** Освободить сервисы (репо закрыт). Все inflight git-процессы убиваются. */
  release(repoPath: string): void {
    const svc = this.map.get(repoPath);
    if (!svc) return;
    this.map.delete(repoPath);
    try { svc.git.killAll(); } catch { /* ignore */ }
  }

  /** Полный shutdown — для выхода. */
  disposeAll(): void {
    for (const svc of this.map.values()) {
      try { svc.git.killAll(); } catch { /* ignore */ }
    }
    this.map.clear();
    if (this.bootstrapCache) {
      try { this.bootstrapCache.git.killAll(); } catch { /* ignore */ }
      this.bootstrapCache = null;
    }
    this.listeners.clear();
  }

  /** Подписка на агрегированный статус операций (для UI: «идёт операция»). */
  onAnyOperationStatusChange(listener: (running: boolean, op: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  size(): number {
    return this.map.size;
  }
}
