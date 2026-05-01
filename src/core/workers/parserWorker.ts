/**
 * Worker thread для разгрузки тяжёлого парсинга от main thread.
 *
 * Принимает задания через MessagePort: `{ id, type: 'parseStatus' | 'parseCommits' | 'computeGraphLayout', payload }`.
 * Возвращает: `{ id, ok: true, result }` или `{ id, ok: false, error }`.
 *
 * Регламент: парсер `parseStatus` на 440k untracked → ~1-3с CPU. Раньше
 * это блокировало IPC и UI на всю длительность. Теперь — работает в
 * worker thread, main process отвечает на IPC, UI остаётся отзывчивым.
 */
import { parentPort } from 'worker_threads';
import * as GitParser from '../git/GitParser';
import { computeGraphLayout } from '../git/GraphLayout';
import type { Commit } from '../git/types';

type Task =
  | { id: number; type: 'parseStatus'; payload: string }
  | { id: number; type: 'parseCommits'; payload: string }
  | { id: number; type: 'computeGraphLayout'; payload: Commit[] };

if (!parentPort) {
  throw new Error('parserWorker: not running as worker_thread');
}

parentPort.on('message', (task: Task) => {
  try {
    let result: unknown;
    switch (task.type) {
      case 'parseStatus':
        result = GitParser.parseStatus(task.payload);
        break;
      case 'parseCommits':
        result = GitParser.parseCommits(task.payload);
        break;
      case 'computeGraphLayout':
        result = computeGraphLayout(task.payload);
        break;
    }
    parentPort!.postMessage({ id: task.id, ok: true, result });
  } catch (err) {
    parentPort!.postMessage({
      id: task.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
