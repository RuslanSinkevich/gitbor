import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { GitErrorClass, JournalEntry, JournalFile, SavedState } from '../git/types';
import { atomicWriteJSON } from './AtomicWrite';

const JOURNAL_FILENAME = 'gitbor-journal.json';
const DEFAULT_MAX_AGE_DAYS = 7;

export class OperationJournal {
  private readonly journalPath: string;
  private _lock: Promise<void> = Promise.resolve();

  constructor(gitDir: string) {
    this.journalPath = join(gitDir, JOURNAL_FILENAME);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    const prev = this._lock;
    this._lock = next;
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }

  async begin(entry: {
    operation: string;
    savedState: SavedState;
    params: Record<string, string>;
  }): Promise<string> {
    return this.withLock(async () => {
      const id = `op_${Date.now()}_${randomBytes(4).toString('hex')}`;

      const journalEntry: JournalEntry = {
        id,
        operation: entry.operation,
        startedAt: Date.now(),
        status: 'started',
        savedState: entry.savedState,
        params: entry.params,
      };

      const journal = await this.read();
      journal.entries.push(journalEntry);
      await atomicWriteJSON(this.journalPath, journal);

      return id;
    });
  }

  async complete(id: string): Promise<void> {
    return this.withLock(async () => {
      const journal = await this.read();
      const entry = journal.entries.find(e => e.id === id);
      if (entry) {
        entry.status = 'completed';
        entry.completedAt = Date.now();
      }
      await atomicWriteJSON(this.journalPath, journal);
    });
  }

  async fail(id: string, error: string, errorClass?: GitErrorClass): Promise<void> {
    return this.withLock(async () => {
      const journal = await this.read();
      const entry = journal.entries.find(e => e.id === id);
      if (entry) {
        entry.status = 'failed';
        entry.completedAt = Date.now();
        entry.error = error;
        if (errorClass) entry.errorClass = errorClass;
      }
      await atomicWriteJSON(this.journalPath, journal);
    });
  }

  async getIncomplete(): Promise<JournalEntry[]> {
    const journal = await this.read();
    return journal.entries.filter(e => e.status === 'started');
  }

  async getAll(): Promise<JournalEntry[]> {
    const journal = await this.read();
    return journal.entries;
  }

  async cleanup(maxAgeDays: number = DEFAULT_MAX_AGE_DAYS): Promise<void> {
    return this.withLock(async () => {
      const journal = await this.read();
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

      journal.entries = journal.entries.filter(
        e => e.status === 'started' || e.startedAt > cutoff
      );

      await atomicWriteJSON(this.journalPath, journal);
    });
  }

  private async read(): Promise<JournalFile> {
    try {
      if (!existsSync(this.journalPath)) {
        return { version: 1, entries: [] };
      }
      const raw = await readFile(this.journalPath, 'utf-8');
      const parsed = JSON.parse(raw) as JournalFile;
      if (!parsed.entries || !Array.isArray(parsed.entries)) {
        return { version: 1, entries: [] };
      }
      return parsed;
    } catch {
      return { version: 1, entries: [] };
    }
  }
}
