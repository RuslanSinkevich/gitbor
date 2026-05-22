import { appendFileSync, statSync, renameSync, existsSync } from 'fs';
import { join } from 'path';
import type { AiDebugSnapshot } from './types';

const MAX_LOG_BYTES = 1 * 1024 * 1024;
const FILE_NAME = 'ai-debug.log';

/**
 * Хранит снимок последнего AI-запроса (request/response/тайминги) и пишет
 * лог в `userData/ai-debug.log` с одно-шаговой ротацией (>1MB → `.1`).
 * Только включается флагом `AiProviderConfig.debugLogging`.
 */
export class AiDebugStore {
  private last: AiDebugSnapshot | null = null;

  constructor(private readonly userDataDir: string) {}

  capture(snapshot: AiDebugSnapshot): void {
    this.last = snapshot;
    this.tryAppend(snapshot);
  }

  getLast(): AiDebugSnapshot | null {
    return this.last;
  }

  clear(): void {
    this.last = null;
  }

  private tryAppend(snapshot: AiDebugSnapshot): void {
    try {
      const file = join(this.userDataDir, FILE_NAME);
      this.rotateIfNeeded(file);
      const line = `${new Date(snapshot.startedAt).toISOString()} ${JSON.stringify(snapshot)}\n`;
      appendFileSync(file, line, 'utf-8');
    } catch {
      // best-effort; не ломаем основной поток если запись лога упала
    }
  }

  private rotateIfNeeded(file: string): void {
    if (!existsSync(file)) return;
    let size: number;
    try { size = statSync(file).size; } catch { return; }
    if (size <= MAX_LOG_BYTES) return;
    try { renameSync(file, `${file}.1`); } catch { /* ignore */ }
  }
}
