# 09 — OperationQueue

## Слой: Safety Layer
## Файл: `src/core/safety/OperationQueue.ts`
## Зависимости: types.ts

---

## Назначение

Очередь git-операций. Git не поддерживает параллельные write-операции (lock файлы).
OperationQueue гарантирует последовательное выполнение write-операций и безопасную параллельность read-операций.

Полностью переиспользуется из SkyFork без изменений.

## Интерфейс

```typescript
class OperationQueue {
  async enqueueRead<T>(label: string, op: () => Promise<T>): Promise<T>

  async enqueueWrite<T>(label: string, op: () => Promise<T>): Promise<T>

  isWriteRunning(): boolean
  getQueueLength(): number
  getCurrentOperation(): string | null

  onStatusChange(listener: (running: boolean, operation: string | null) => void): () => void
}
```

## Правила

1. Write-операция ждёт завершения ВСЕХ текущих (read и write)
2. Read-операции запускаются параллельно, если нет write в процессе
3. Если идёт write — read ждёт
4. Write друг за другом — строго последовательно
5. UI получает уведомление о статусе (спиннер)

## Реализация

```typescript
class OperationQueue {
  private writeRunning = false;
  private readCount = 0;
  private queue: QueueItem[] = [];
  private listeners = new Set<StatusListener>();

  async enqueueWrite<T>(label: string, op: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        type: 'write',
        label,
        execute: async () => {
          try { resolve(await op()); }
          catch (e) { reject(e); }
        }
      });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.writeRunning || this.queue.length === 0) return;

    const next = this.queue[0];

    if (next.type === 'write') {
      if (this.readCount > 0) return;

      this.queue.shift();
      this.writeRunning = true;
      this.notify(true, next.label);

      try {
        await next.execute();
      } finally {
        this.writeRunning = false;
        this.notify(false, null);
        this.processQueue();
      }
    }
    // ... read logic
  }
}
```

## Edge Cases

- Операция зависла (таймаут) → GitExecutor убьёт процесс → ошибка → очередь продолжит
- Закрытие приложения во время write → SafetyNet/Journal зафиксирует незавершённость
- 10 read-запросов подряд → все запустятся параллельно (если нет write)
- UI отправил 5 команд быстро → все встанут в очередь, выполнятся по порядку
