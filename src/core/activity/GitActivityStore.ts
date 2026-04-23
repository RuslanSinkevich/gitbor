export interface GitActivityCommand {
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  startedAt: number;
}

export type GitActivityStatus = 'running' | 'success' | 'error';

export interface GitActivityEntry {
  id: string;
  operation: string;
  repoPath: string | null;
  startedAt: number;
  finishedAt: number | null;
  status: GitActivityStatus;
  error: string | null;
  commands: GitActivityCommand[];
}

type Listener = (event: ActivityEvent) => void;

export type ActivityEvent =
  | { type: 'added'; entry: GitActivityEntry }
  | { type: 'updated'; entry: GitActivityEntry }
  | { type: 'cleared' };

const MAX_ENTRIES = 100;
const OUTPUT_CAP_BYTES = 16 * 1024; // 16 KiB на stdout/stderr одной команды

function cap(text: string): string {
  if (!text) return '';
  if (text.length <= OUTPUT_CAP_BYTES) return text;
  const head = text.slice(0, OUTPUT_CAP_BYTES);
  return head + `\n... [truncated ${text.length - OUTPUT_CAP_BYTES} chars]`;
}

export class GitActivityStore {
  private entries: GitActivityEntry[] = [];
  private listeners = new Set<Listener>();
  private seq = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ActivityEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* ignore */ }
    }
  }

  getSnapshot(): GitActivityEntry[] {
    return this.entries.slice();
  }

  start(operation: string, repoPath: string | null): string {
    const id = `act-${Date.now()}-${++this.seq}`;
    const entry: GitActivityEntry = {
      id,
      operation,
      repoPath,
      startedAt: Date.now(),
      finishedAt: null,
      status: 'running',
      error: null,
      commands: [],
    };
    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.length = MAX_ENTRIES;
    }
    this.emit({ type: 'added', entry });
    return id;
  }

  appendCommand(id: string, command: GitActivityCommand): void {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;
    entry.commands.push({
      ...command,
      stdout: cap(command.stdout),
      stderr: cap(command.stderr),
    });
    this.emit({ type: 'updated', entry });
  }

  finish(id: string, success: boolean, error?: string): void {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;
    entry.finishedAt = Date.now();
    entry.status = success ? 'success' : 'error';
    entry.error = error ?? null;
    this.emit({ type: 'updated', entry });
  }

  clear(): void {
    this.entries = [];
    this.emit({ type: 'cleared' });
  }
}

export const gitActivityStore = new GitActivityStore();
