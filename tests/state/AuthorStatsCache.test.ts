import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AuthorCodeStats } from '../../src/core/bridge/messages';

/**
 * Unit-тесты AuthorStatsCache (persistent, per-author code stats).
 * Кэш-хит зависит от (repoPath, authorName+authorEmail, headHash, version).
 */
let tmpRoot: string;

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpRoot,
  },
}));

async function importFresh() {
  vi.resetModules();
  return await import('../../src/core/state/AuthorStatsCache');
}

function makeStats(overrides: Partial<AuthorCodeStats> = {}): AuthorCodeStats {
  return {
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    headHash: 'head-abc',
    addedLines: 100,
    deletedLines: 20,
    netLines: 80,
    touchedFiles: 5,
    binaryFiles: 0,
    calculatedAt: 1700000000,
    ...overrides,
  };
}

beforeEach(() => {
  tmpRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'gitbor-statscache-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('AuthorStatsCache', () => {
  describe('loadAuthorStatsCache', () => {
    it('returns null when cache miss (no file)', async () => {
      const { loadAuthorStatsCache } = await importFresh();
      const r = await loadAuthorStatsCache('/repo', 'Alice', 'a@b', 'h');
      expect(r).toBeNull();
    });

    it('returns stats on cache hit (same author + head)', async () => {
      const { loadAuthorStatsCache, saveAuthorStatsCache } = await importFresh();
      const stats = makeStats();
      await saveAuthorStatsCache('/repo/a', stats);
      const r = await loadAuthorStatsCache(
        '/repo/a', stats.authorName, stats.authorEmail, stats.headHash,
      );
      expect(r).not.toBeNull();
      expect(r!.addedLines).toBe(100);
      expect(r!.deletedLines).toBe(20);
    });

    it('returns null when headHash differs (cache invalidated)', async () => {
      const { loadAuthorStatsCache, saveAuthorStatsCache } = await importFresh();
      const stats = makeStats({ headHash: 'old-head' });
      await saveAuthorStatsCache('/repo/b', stats);
      const r = await loadAuthorStatsCache(
        '/repo/b', stats.authorName, stats.authorEmail, 'new-head',
      );
      expect(r).toBeNull();
    });

    it('returns null when authorName differs', async () => {
      const { loadAuthorStatsCache, saveAuthorStatsCache } = await importFresh();
      const stats = makeStats({ authorName: 'Alice' });
      await saveAuthorStatsCache('/repo/c', stats);
      const r = await loadAuthorStatsCache(
        '/repo/c', 'Bob', stats.authorEmail, stats.headHash,
      );
      // Заметь: хеш-ключ файла строится из (name+email), потому Bob
      // даже не найдёт файл — это тоже null.
      expect(r).toBeNull();
    });

    it('returns null when authorEmail differs', async () => {
      const { loadAuthorStatsCache, saveAuthorStatsCache } = await importFresh();
      const stats = makeStats();
      await saveAuthorStatsCache('/repo/d', stats);
      const r = await loadAuthorStatsCache(
        '/repo/d', stats.authorName, 'other@email', stats.headHash,
      );
      expect(r).toBeNull();
    });

    it('returns null on corrupted JSON', async () => {
      const { loadAuthorStatsCache, saveAuthorStatsCache } = await importFresh();
      const stats = makeStats();
      await saveAuthorStatsCache('/repo/e', stats);
      // Подменяем содержимое одного из файлов на мусор
      const root = path.join(tmpRoot, 'stats-cache');
      const repos = await fs.readdir(root);
      const repoDir = path.join(root, repos[0]);
      const files = await fs.readdir(repoDir);
      await fs.writeFile(path.join(repoDir, files[0]), '{ not json');
      const r = await loadAuthorStatsCache(
        '/repo/e', stats.authorName, stats.authorEmail, stats.headHash,
      );
      expect(r).toBeNull();
    });

    it('returns null when version mismatches', async () => {
      const { loadAuthorStatsCache, saveAuthorStatsCache } = await importFresh();
      const stats = makeStats();
      await saveAuthorStatsCache('/repo/f', stats);
      const root = path.join(tmpRoot, 'stats-cache');
      const [repoDirName] = await fs.readdir(root);
      const repoDir = path.join(root, repoDirName);
      const [file] = await fs.readdir(repoDir);
      const filePath = path.join(repoDir, file);
      const entry = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      entry.version = 999;
      await fs.writeFile(filePath, JSON.stringify(entry));
      const r = await loadAuthorStatsCache(
        '/repo/f', stats.authorName, stats.authorEmail, stats.headHash,
      );
      expect(r).toBeNull();
    });

    it('returns null when repoPath in file mismatches argument', async () => {
      const { loadAuthorStatsCache, saveAuthorStatsCache } = await importFresh();
      const stats = makeStats();
      await saveAuthorStatsCache('/repo/g', stats);
      const root = path.join(tmpRoot, 'stats-cache');
      const [repoDirName] = await fs.readdir(root);
      const repoDir = path.join(root, repoDirName);
      const [file] = await fs.readdir(repoDir);
      const filePath = path.join(repoDir, file);
      const entry = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      entry.repoPath = '/something/else';
      await fs.writeFile(filePath, JSON.stringify(entry));
      const r = await loadAuthorStatsCache(
        '/repo/g', stats.authorName, stats.authorEmail, stats.headHash,
      );
      expect(r).toBeNull();
    });
  });

  describe('saveAuthorStatsCache', () => {
    it('creates a JSON file under userData/stats-cache/<repoKey>/<authorKey>.json', async () => {
      const { saveAuthorStatsCache } = await importFresh();
      await saveAuthorStatsCache('/repo/h', makeStats());
      const root = path.join(tmpRoot, 'stats-cache');
      const repoDirs = await fs.readdir(root);
      expect(repoDirs).toHaveLength(1);
      const files = await fs.readdir(path.join(root, repoDirs[0]));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[0-9a-f]{16}\.json$/);
    });

    it('overwrites previous entry on second save (same author)', async () => {
      const { saveAuthorStatsCache, loadAuthorStatsCache } = await importFresh();
      await saveAuthorStatsCache('/repo/i', makeStats({ addedLines: 1 }));
      await saveAuthorStatsCache('/repo/i', makeStats({ addedLines: 999 }));
      const loaded = await loadAuthorStatsCache(
        '/repo/i', 'Alice', 'alice@example.com', 'head-abc',
      );
      expect(loaded!.addedLines).toBe(999);
    });

    it('stores different authors in different files within the same repo', async () => {
      const { saveAuthorStatsCache } = await importFresh();
      await saveAuthorStatsCache('/repo/j', makeStats({ authorName: 'Alice' }));
      await saveAuthorStatsCache('/repo/j', makeStats({ authorName: 'Bob', authorEmail: 'b@b' }));
      const root = path.join(tmpRoot, 'stats-cache');
      const [repoDir] = await fs.readdir(root);
      const files = await fs.readdir(path.join(root, repoDir));
      expect(files).toHaveLength(2);
    });

    it('uses atomic .tmp + rename (no leftover .tmp files)', async () => {
      const { saveAuthorStatsCache } = await importFresh();
      await saveAuthorStatsCache('/repo/k', makeStats());
      const root = path.join(tmpRoot, 'stats-cache');
      const [repoDir] = await fs.readdir(root);
      const files = await fs.readdir(path.join(root, repoDir));
      expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    });

    it('does not throw when mkdir fails (best-effort cache)', async () => {
      const blocker = path.join(tmpRoot, 'blocker');
      await fs.writeFile(blocker, 'file');
      tmpRoot = blocker;
      const { saveAuthorStatsCache } = await importFresh();
      await expect(
        saveAuthorStatsCache('/repo/x', makeStats()),
      ).resolves.toBeUndefined();
    });

    it('uses different repo dirs for different repos', async () => {
      const { saveAuthorStatsCache } = await importFresh();
      await saveAuthorStatsCache('/repo/p', makeStats());
      await saveAuthorStatsCache('/repo/q', makeStats());
      const root = path.join(tmpRoot, 'stats-cache');
      const dirs = await fs.readdir(root);
      expect(dirs).toHaveLength(2);
    });
  });
});
