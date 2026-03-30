type StatusListener = (running: boolean, operation: string | null) => void;

interface QueueItem {
  type: 'read' | 'write';
  label: string;
  execute: () => Promise<void>;
}

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
          try {
            resolve(await op());
          } catch (e) {
            reject(e);
          }
        },
      });
      this.processQueue();
    });
  }

  async enqueueWrite<T>(label: string, op: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        type: 'write',
        label,
        execute: async () => {
          try {
            resolve(await op());
          } catch (e) {
            reject(e);
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

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) return;

    const next = this.queue[0];

    if (next.type === 'write') {
      if (this.writeRunning || this.readCount > 0) return;

      this.queue.shift();
      this.writeRunning = true;
      this.currentLabel = next.label;
      this.notify(true, next.label);

      try {
        await next.execute();
      } finally {
        this.writeRunning = false;
        this.currentLabel = null;
        this.notify(false, null);
        this.processQueue();
      }
    } else {
      if (this.writeRunning) return;

      const reads: QueueItem[] = [];
      while (this.queue.length > 0 && this.queue[0].type === 'read') {
        reads.push(this.queue.shift()!);
      }

      this.readCount += reads.length;

      await Promise.all(
        reads.map(async (item) => {
          try {
            await item.execute();
          } finally {
            this.readCount--;
            if (this.readCount === 0) {
              this.processQueue();
            }
          }
        })
      );
    }
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
