import {
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
  mkdirSync,
  unlinkSync,
  existsSync,
} from 'fs';
import { open, rename, mkdir, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';

const MAX_RETRIES_WIN = 3;
const RETRY_DELAY_MS = 50;

export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);

  const fd = await open(tmpPath, 'w');
  try {
    await fd.writeFile(data, 'utf-8');
    await fd.sync();
  } finally {
    await fd.close();
  }

  await renameWithRetry(tmpPath, filePath);

  await fsyncDir(dir);
}

export async function atomicWriteJSON(filePath: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await atomicWriteFile(filePath, json);
}

export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);

  writeFileSync(tmpPath, data, 'utf-8');
  const fd = openSync(tmpPath, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSyncWithRetry(tmpPath, filePath);
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES_WIN; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      if (attempt === MAX_RETRIES_WIN - 1) throw err;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

function renameSyncWithRetry(from: string, to: string): void {
  for (let attempt = 0; attempt < MAX_RETRIES_WIN; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if (attempt === MAX_RETRIES_WIN - 1) throw err;
    }
  }
}

async function fsyncDir(dir: string): Promise<void> {
  try {
    const fd = await open(dir, 'r');
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
  } catch {
    // fsync directory not supported on all OS (Windows) — graceful fallback
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function cleanupTmpFiles(dir: string): void {
  try {
    const { readdirSync } = require('fs') as typeof import('fs');
    for (const f of readdirSync(dir)) {
      if (f.startsWith('.tmp-')) {
        try {
          unlinkSync(join(dir, f));
        } catch {
          // ignore — may be in use
        }
      }
    }
  } catch {
    // dir doesn't exist or not readable
  }
}
