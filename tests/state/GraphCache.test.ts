import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Commit } from '../../src/core/git/types/git';
import type { GraphLayoutData } from '../../src/core/git/types/graph';

/**
 * Unit-тесты GraphCache (persistent disk cache, 5000-cap, JSON-on-disk).
 * Мокаем electron.app.getPath на временную папку, чтобы изолировать тесты.
 */
let tmpRoot: string;

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpRoot,
  },
}));

async function importFresh() {
  vi.resetModules();
  return await import('../../src/core/state/GraphCache');
}

function makeCommit(hash: string, parent = ''): Commit {
  return {
    hash,
    parents: parent ? [parent] : [],
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    authorDate: 1700000000,
    refs: [],
    subject: `commit ${hash}`,
  };
}

function makeLayout(nodeCount: number): GraphLayoutData {
  return {
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      commitIndex: i,
      column: 0,
      color: '#fff',
      connections: [],
    })),
    maxColumns: 1,
    mergeLinks: [],
  };
}

beforeEach(() => {
  tmpRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'skyfork-graphcache-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('GraphCache', () => {
  describe('loadGraphCache', () => {
    it('returns null when cache file does not exist', async () => {
      const { loadGraphCache } = await importFresh();
      const result = await loadGraphCache('/some/repo');
      expect(result).toBeNull();
    });

    it('returns null on corrupted JSON', async () => {
      const { loadGraphCache, saveGraphCache } = await importFresh();
      // Сначала создаём валидный кэш, чтобы узнать путь
      await saveGraphCache('/repo/a', 'head1', [makeCommit('a1')], makeLayout(1));
      const dir = path.join(tmpRoot, 'graphCache');
      const files = await fs.readdir(dir);
      expect(files.length).toBe(1);
      await fs.writeFile(path.join(dir, files[0]), 'not json{');
      const result = await loadGraphCache('/repo/a');
      expect(result).toBeNull();
    });

    it('returns null when version mismatches', async () => {
      const { loadGraphCache, saveGraphCache } = await importFresh();
      await saveGraphCache('/repo/b', 'head', [makeCommit('a')], makeLayout(1));
      const dir = path.join(tmpRoot, 'graphCache');
      const files = await fs.readdir(dir);
      const filePath = path.join(dir, files[0]);
      const entry = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      entry.version = 999;
      await fs.writeFile(filePath, JSON.stringify(entry));
      const result = await loadGraphCache('/repo/b');
      expect(result).toBeNull();
    });

    it('returns null when repoPath in file mismatches argument', async () => {
      const { loadGraphCache, saveGraphCache } = await importFresh();
      await saveGraphCache('/repo/c', 'head', [makeCommit('a')], makeLayout(1));
      const dir = path.join(tmpRoot, 'graphCache');
      const files = await fs.readdir(dir);
      const filePath = path.join(dir, files[0]);
      const entry = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      entry.repoPath = '/some/other/path';
      await fs.writeFile(filePath, JSON.stringify(entry));
      const result = await loadGraphCache('/repo/c');
      expect(result).toBeNull();
    });

    it('returns null when commits is not an array', async () => {
      const { loadGraphCache, saveGraphCache } = await importFresh();
      await saveGraphCache('/repo/d', 'head', [makeCommit('a')], makeLayout(1));
      const dir = path.join(tmpRoot, 'graphCache');
      const files = await fs.readdir(dir);
      const filePath = path.join(dir, files[0]);
      const entry = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      entry.commits = 'not-an-array';
      await fs.writeFile(filePath, JSON.stringify(entry));
      const result = await loadGraphCache('/repo/d');
      expect(result).toBeNull();
    });

    it('returns null when layout is missing', async () => {
      const { loadGraphCache, saveGraphCache } = await importFresh();
      await saveGraphCache('/repo/e', 'head', [makeCommit('a')], makeLayout(1));
      const dir = path.join(tmpRoot, 'graphCache');
      const files = await fs.readdir(dir);
      const filePath = path.join(dir, files[0]);
      const entry = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      delete entry.layout;
      await fs.writeFile(filePath, JSON.stringify(entry));
      const result = await loadGraphCache('/repo/e');
      expect(result).toBeNull();
    });

    it('returns valid entry for fresh save', async () => {
      const { loadGraphCache, saveGraphCache } = await importFresh();
      const commits = [makeCommit('a'), makeCommit('b', 'a')];
      const layout = makeLayout(2);
      await saveGraphCache('/repo/f', 'head-hash', commits, layout);
      const result = await loadGraphCache('/repo/f');
      expect(result).not.toBeNull();
      expect(result!.repoPath).toBe('/repo/f');
      expect(result!.headHash).toBe('head-hash');
      expect(result!.commits).toHaveLength(2);
      expect(result!.commits[0].hash).toBe('a');
      expect(result!.layout.nodes).toHaveLength(2);
      expect(result!.savedAt).toBeGreaterThan(0);
    });
  });

  describe('saveGraphCache', () => {
    it('writes a JSON file under userData/graphCache/', async () => {
      const { saveGraphCache } = await importFresh();
      await saveGraphCache('/repo/g', 'h', [makeCommit('a')], makeLayout(1));
      const dir = path.join(tmpRoot, 'graphCache');
      const files = await fs.readdir(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[0-9a-f]{16}\.json$/);
    });

    it('caps commits to MAX_CACHED_COMMITS (5000) on save', async () => {
      const { saveGraphCache, loadGraphCache } = await importFresh();
      const commits: Commit[] = Array.from({ length: 6000 }, (_, i) =>
        makeCommit(`c${i}`, i > 0 ? `c${i - 1}` : ''),
      );
      const layout = makeLayout(6000);
      await saveGraphCache('/repo/h', 'head', commits, layout);
      const loaded = await loadGraphCache('/repo/h');
      expect(loaded).not.toBeNull();
      expect(loaded!.commits).toHaveLength(5000);
      expect(loaded!.commits[0].hash).toBe('c0');
      expect(loaded!.commits[4999].hash).toBe('c4999');
    });

    it('caps layout nodes to match capped commits length', async () => {
      const { saveGraphCache, loadGraphCache } = await importFresh();
      const commits: Commit[] = Array.from({ length: 6000 }, (_, i) =>
        makeCommit(`c${i}`, i > 0 ? `c${i - 1}` : ''),
      );
      const layout = makeLayout(6000);
      await saveGraphCache('/repo/i', 'h', commits, layout);
      const loaded = await loadGraphCache('/repo/i');
      expect(loaded!.layout.nodes).toHaveLength(5000);
      expect(loaded!.layout.nodes.every((n) => n.commitIndex < 5000)).toBe(true);
    });

    it('uses atomic rename (.tmp -> final) so partial writes do not corrupt', async () => {
      const { saveGraphCache } = await importFresh();
      await saveGraphCache('/repo/j', 'h', [makeCommit('a')], makeLayout(1));
      const dir = path.join(tmpRoot, 'graphCache');
      const files = await fs.readdir(dir);
      // ровно один файл, без хвостовых .tmp
      expect(files).toHaveLength(1);
      expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    });

    it('overwrites existing entry on second save', async () => {
      const { saveGraphCache, loadGraphCache } = await importFresh();
      await saveGraphCache('/repo/k', 'head-1', [makeCommit('a')], makeLayout(1));
      await saveGraphCache('/repo/k', 'head-2', [makeCommit('b')], makeLayout(1));
      const loaded = await loadGraphCache('/repo/k');
      expect(loaded!.headHash).toBe('head-2');
      expect(loaded!.commits[0].hash).toBe('b');
    });

    it('uses different cache files for different repos', async () => {
      const { saveGraphCache } = await importFresh();
      await saveGraphCache('/repo/x', 'h', [makeCommit('a')], makeLayout(1));
      await saveGraphCache('/repo/y', 'h', [makeCommit('a')], makeLayout(1));
      const dir = path.join(tmpRoot, 'graphCache');
      const files = await fs.readdir(dir);
      expect(files).toHaveLength(2);
    });

    it('does not throw if userData directory cannot be created (best-effort)', async () => {
      // Подменяем tmpRoot на путь, по которому fs.mkdir упадёт (вложенная
      // запись поверх обычного файла). saveGraphCache должен молча проглотить.
      const fakeFile = path.join(tmpRoot, 'blocker');
      await fs.writeFile(fakeFile, 'I am a file, not a dir');
      tmpRoot = fakeFile;
      const { saveGraphCache } = await importFresh();
      await expect(
        saveGraphCache('/repo/z', 'h', [makeCommit('a')], makeLayout(1)),
      ).resolves.toBeUndefined();
    });
  });

  describe('cache key', () => {
    it('produces 16-char hex filename derived from repoPath', async () => {
      const { saveGraphCache } = await importFresh();
      await saveGraphCache('/some/repo/path', 'h', [makeCommit('a')], makeLayout(1));
      const dir = path.join(tmpRoot, 'graphCache');
      const [file] = await fs.readdir(dir);
      expect(file).toMatch(/^[0-9a-f]{16}\.json$/);
    });

    it('different repoPath produces different filename', async () => {
      const { saveGraphCache } = await importFresh();
      await saveGraphCache('/a', 'h', [makeCommit('x')], makeLayout(1));
      await saveGraphCache('/b', 'h', [makeCommit('x')], makeLayout(1));
      const dir = path.join(tmpRoot, 'graphCache');
      const files = await fs.readdir(dir);
      const unique = new Set(files);
      expect(unique.size).toBe(2);
    });
  });
});
