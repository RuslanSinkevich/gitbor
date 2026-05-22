import { mainLogger } from '../utils/Logger';

type StatusListener = (running: boolean, operation: string | null) => void;

interface QueueItem {
  type: 'read' | 'write';
  label: string;
  execute: () => Promise<void>;
}

export interface EnqueueWriteOptions {
  /**
   * Опция оставлена для совместимости — `OperationQueue` больше не
   * делает синхронных меток про `index.lock` (это размывало роль
   * `PreflightChecks`/`LockWaiter`). Передавать необязательно.
   */
  repoPath?: string;
}

/**
 * Per-repo очередь git-операций. В пределах одной репы write-операции
 * сериализуются (git не любит конкурентные индексные записи), но read'ы
 * (status/log/diff) ходят параллельно — и параллельно с write'ом тоже:
 * git это терпит, данные могут чуть отставать, но UI не залипает.
 *
 * Между репозиториями нет общего mutex'а — каждое репо имеет свой
 * экземпляр `OperationQueue` через `RepoServicesRegistry`, так что
 * длинный `pull` на A не блокирует `checkout` на B.
 */
export class OperationQueue {
  private writeRunning = false;
  private readCount = 0;
  private queue: QueueItem[] = [];
  private currentLabel: string | null = null;
  private readonly listeners = new Set<StatusListener>();

  async enqueueRead<T>(label: string, op: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        type: 'read',
        label,
        execute: async () => {
          const started = Date.now();
          try {
            resolve(await op());
          } catch (e) {
            reject(e);
          } finally {
            mainLogger.debug(`queue.read ${label}: ${Date.now() - started}ms`);
          }
        },
      });
      this.processQueue();
    });
  }

  async enqueueWrite<T>(label: string, op: () => Promise<T>, _opts?: EnqueueWriteOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        type: 'write',
        label,
        execute: async () => {
          const started = Date.now();
          try {
            resolve(await op());
          } catch (e) {
            reject(e);
          } finally {
            mainLogger.debug(`queue.write ${label}: ${Date.now() - started}ms`);
          }
        },
      });
      this.processQueue();
    });
  }

  isWriteRunning(): boolean {
    return this.writeRunning;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getCurrentOperation(): string | null {
    return this.currentLabel;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private processQueue(): void {
    if (this.queue.length === 0) return;

    // 1) Все pending read'ы с головы — параллельно (и параллельно с
    //    уже идущим write'ом, если он есть).
    this.drainAndRunReads();

    // 2) Если уже что-то пишется или голова не write — выходим.
    if (this.writeRunning) return;
    if (this.queue.length === 0 || this.queue[0].type !== 'write') return;

    const next = this.queue.shift()!;
    this.writeRunning = true;
    this.currentLabel = next.label;
    this.notify(true, next.label);

    // 3) После того как write ушёл с головы, в очереди могут оказаться
    //    read'ы — их можно запустить параллельно с этим write'ом.
    this.drainAndRunReads();

    void (async () => {
      try {
        await next.execute();
      } finally {
        this.writeRunning = false;
        this.currentLabel = null;
        this.notify(false, null);
        this.processQueue();
      }
    })();
  }

  private drainAndRunReads(): void {
    const reads = this.drainHeadReads();
    if (reads.length === 0) return;
    this.readCount += reads.length;
    void Promise.all(
      reads.map(async (item) => {
        try {
          await item.execute();
        } finally {
          this.readCount--;
        }
      }),
    ).then(() => {
      if (this.readCount === 0 && !this.writeRunning) this.processQueue();
    });
  }

  /**
   * Снять с головы очереди подряд идущие read'ы — их можно стартовать
   * параллельно (и параллельно с уже идущим write'ом тоже).
   */
  private drainHeadReads(): QueueItem[] {
    const reads: QueueItem[] = [];
    while (this.queue.length > 0 && this.queue[0].type === 'read') {
      reads.push(this.queue.shift()!);
    }
    return reads;
  }

  private notify(running: boolean, operation: string | null): void {
    for (const listener of this.listeners) {
      try {
        listener(running, operation);
      } catch {
        // listener error — don't crash the queue
      }
    }
  }
}
