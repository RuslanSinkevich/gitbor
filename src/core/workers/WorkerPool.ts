/**
 * Пул `worker_threads` для разгрузки CPU-тяжёлых операций (parseStatus,
 * parseCommits, computeGraphLayout) от main thread процесса Electron.
 *
 * Зачем: на профильном репо (`C:\Users\<USER>` с 440k untracked файлов)
 * `parseStatus` синхронно занимает 1-3 секунды на main thread; всё это
 * время IPC замирает и UI не отвечает на клики. Перенос в worker делает
 * main thread отзывчивым к IPC и оставляет worker в фоне.
 *
 * Минимально достаточный пул: 2 воркера, round-robin. Они переиспользуются,
 * не пересоздаются на каждое задание.
 */
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as GitParser from '../git/GitParser';
import { mainLogger } from '../utils/Logger';
import { computeGraphLayout } from '../git/GraphLayout';
import type { Commit, FileStatus, GraphLayoutData } from '../git/types';

interface PendingTask {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface WorkerSlot {
  worker: Worker;
  inflight: Map<number, PendingTask>;
  load: number;
}

const PARSE_STATUS_OFFLOAD_THRESHOLD = 256 * 1024;
const PARSE_COMMITS_OFFLOAD_THRESHOLD = 512 * 1024;
const GRAPH_LAYOUT_OFFLOAD_THRESHOLD = 2000;

class WorkerPoolImpl {
  private slots: WorkerSlot[] = [];
  private nextId = 0;
  private readonly poolSize = 2;

  private getWorkerPath(): string {
    // dist/main/core/workers/parserWorker.js — после сборки tsc.
    // В тестах и dev до tsc файл лежит как .ts, но воркер не запускается,
    // вместо него используется sync-fallback через size-threshold (см. ниже).
    return path.join(__dirname, 'parserWorker.js');
  }

  private ensureSlots(): void {
    if (this.slots.length > 0) return;
    for (let i = 0; i < this.poolSize; i++) {
      this.spawnSlot();
    }
  }

  /**
   * Создать (или пересоздать) одного воркера и добавить его в `slots`.
   * При ошибке worker'а / выходе с ненулевым кодом — slot вычищается и
   * заменяется новым; иначе мёртвый воркер остался бы в пуле и все
   * последующие dispatch'и уходили бы в трупа (без message → зависают).
   */
  private spawnSlot(): void {
    const workerPath = this.getWorkerPath();
    let w: Worker;
    try {
      w = new Worker(workerPath);
    } catch (err) {
      mainLogger.warn(`WorkerPool: failed to spawn worker: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const slot: WorkerSlot = { worker: w, inflight: new Map(), load: 0 };
    w.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const pending = slot.inflight.get(msg.id);
      if (!pending) return;
      slot.inflight.delete(msg.id);
      slot.load = Math.max(0, slot.load - 1);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error ?? 'worker error'));
    });
    const onDeath = (cause: Error | { code: number }): void => {
      const idx = this.slots.indexOf(slot);
      if (idx === -1) return; // уже удалён
      this.slots.splice(idx, 1);
      const err = cause instanceof Error ? cause : new Error(`worker exited with code ${cause.code}`);
      for (const pending of slot.inflight.values()) pending.reject(err);
      slot.inflight.clear();
      try { slot.worker.terminate(); } catch { /* already dead */ }
      // Респавн отложено через setImmediate, чтобы не вкручивать
      // recursive crash-loop при битом parserWorker.js.
      setImmediate(() => {
        if (this.slots.length < this.poolSize) this.spawnSlot();
      });
    };
    w.on('error', onDeath);
    w.on('exit', (code) => { if (code !== 0) onDeath({ code }); });
    this.slots.push(slot);
  }

  private pickSlot(): WorkerSlot | null {
    if (this.slots.length === 0) return null;
    let best = this.slots[0];
    for (const s of this.slots) if (s.load < best.load) best = s;
    return best;
  }

  private dispatch<T>(type: 'parseStatus' | 'parseCommits' | 'computeGraphLayout', payload: unknown): Promise<T> {
    this.ensureSlots();
    const slot = this.pickSlot();
    if (!slot) {
      // Нет рабочих воркеров — выполняем inline (fallback).
      return Promise.resolve(this.runInline<T>(type, payload));
    }
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      slot.inflight.set(id, { resolve: resolve as (v: unknown) => void, reject });
      slot.load++;
      slot.worker.postMessage({ id, type, payload });
    });
  }

  private runInline<T>(type: 'parseStatus' | 'parseCommits' | 'computeGraphLayout', payload: unknown): T {
    switch (type) {
      case 'parseStatus': return GitParser.parseStatus(payload as string) as unknown as T;
      case 'parseCommits': return GitParser.parseCommits(payload as string) as unknown as T;
      case 'computeGraphLayout': return computeGraphLayout(payload as Commit[]) as unknown as T;
    }
  }

  parseStatus(stdout: string): Promise<FileStatus[]> | FileStatus[] {
    if (stdout.length < PARSE_STATUS_OFFLOAD_THRESHOLD) {
      return GitParser.parseStatus(stdout);
    }
    return this.dispatch<FileStatus[]>('parseStatus', stdout);
  }

  parseCommits(stdout: string): Promise<Commit[]> | Commit[] {
    if (stdout.length < PARSE_COMMITS_OFFLOAD_THRESHOLD) {
      return GitParser.parseCommits(stdout);
    }
    return this.dispatch<Commit[]>('parseCommits', stdout);
  }

  computeGraphLayout(commits: Commit[]): Promise<GraphLayoutData> | GraphLayoutData {
    if (commits.length < GRAPH_LAYOUT_OFFLOAD_THRESHOLD) {
      return computeGraphLayout(commits);
    }
    return this.dispatch<GraphLayoutData>('computeGraphLayout', commits);
  }

  dispose(): void {
    for (const slot of this.slots) {
      try { slot.worker.terminate(); } catch { /* ignore */ }
    }
    this.slots = [];
  }
}

export const workerPool = new WorkerPoolImpl();
