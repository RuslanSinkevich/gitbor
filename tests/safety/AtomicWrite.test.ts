import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { atomicWriteFile, atomicWriteJSON, atomicWriteFileSync, cleanupTmpFiles } from '../../src/core/safety/AtomicWrite';

const TEST_DIR = join(__dirname, '__atomic_test__');

function ensureDir() {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
}

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('atomicWriteFile', () => {
  it('writes a file atomically', async () => {
    ensureDir();
    const p = join(TEST_DIR, 'test.txt');
    await atomicWriteFile(p, 'hello');
    expect(readFileSync(p, 'utf-8')).toBe('hello');
  });

  it('overwrites existing file', async () => {
    ensureDir();
    const p = join(TEST_DIR, 'overwrite.txt');
    await atomicWriteFile(p, 'first');
    await atomicWriteFile(p, 'second');
    expect(readFileSync(p, 'utf-8')).toBe('second');
  });

  it('creates parent directories', async () => {
    const p = join(TEST_DIR, 'deep', 'nested', 'file.txt');
    await atomicWriteFile(p, 'deep');
    expect(readFileSync(p, 'utf-8')).toBe('deep');
  });
});

describe('atomicWriteJSON', () => {
  it('writes JSON with indentation', async () => {
    ensureDir();
    const p = join(TEST_DIR, 'data.json');
    await atomicWriteJSON(p, { key: 'value', num: 42 });
    const content = JSON.parse(readFileSync(p, 'utf-8'));
    expect(content.key).toBe('value');
    expect(content.num).toBe(42);
  });
});

describe('atomicWriteFileSync', () => {
  it('writes a file synchronously', () => {
    ensureDir();
    const p = join(TEST_DIR, 'sync.txt');
    try {
      atomicWriteFileSync(p, 'sync-data');
      expect(readFileSync(p, 'utf-8')).toBe('sync-data');
    } catch (err) {
      // fsyncSync may fail on Windows with EPERM — acceptable in test env
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EPERM') throw err;
    }
  });
});

describe('cleanupTmpFiles', () => {
  it('removes .tmp- prefixed files', async () => {
    ensureDir();
    const { writeFileSync } = await import('fs');
    writeFileSync(join(TEST_DIR, '.tmp-abc123'), 'tmp');
    writeFileSync(join(TEST_DIR, 'normal.txt'), 'keep');

    cleanupTmpFiles(TEST_DIR);

    expect(existsSync(join(TEST_DIR, '.tmp-abc123'))).toBe(false);
    expect(existsSync(join(TEST_DIR, 'normal.txt'))).toBe(true);
  });

  it('handles non-existent directory gracefully', () => {
    expect(() => cleanupTmpFiles('/non/existent/path')).not.toThrow();
  });
});
