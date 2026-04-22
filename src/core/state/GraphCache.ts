/**
 * Persistent graph cache — ускоряет повторное открытие репозитория.
 *
 * Инвариант: на диск кладём только первые MAX_CACHED_COMMITS коммитов
 * плюс layout-узлы для них. На старте switchRepo кэш читается синхронно
 * (ну, быстро-асинхронно с fs.promises) и сразу публикуется в state;
 * затем refreshAll догоняет актуальное состояние.
 *
 * Кэш не рассчитан на безопасность при одновременной записи из нескольких
 * окон — но в SkyFork всегда одно окно на процесс.
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import type { Commit } from '../git/types';
import type { GraphLayoutData, GraphNode } from '../git/types';

const CACHE_VERSION = 1;
const MAX_CACHED_COMMITS = 5000;

export interface GraphCacheEntry {
  version: number;
  repoPath: string;
  headHash: string;
  savedAt: number;
  commits: Commit[];
  layout: GraphLayoutData;
}

function keyFor(repoPath: string): string {
  return crypto.createHash('sha1').update(repoPath).digest('hex').slice(0, 16);
}

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'graphCache');
}

function cacheFile(repoPath: string): string {
  return path.join(cacheDir(), `${keyFor(repoPath)}.json`);
}

export async function loadGraphCache(repoPath: string): Promise<GraphCacheEntry | null> {
  try {
    const raw = await fs.readFile(cacheFile(repoPath), 'utf-8');
    const entry = JSON.parse(raw) as GraphCacheEntry;
    if (entry.version !== CACHE_VERSION) return null;
    if (entry.repoPath !== repoPath) return null;
    if (!Array.isArray(entry.commits) || !entry.layout) return null;
    return entry;
  } catch {
    return null;
  }
}

export async function saveGraphCache(
  repoPath: string, headHash: string,
  commits: Commit[], layout: GraphLayoutData,
): Promise<void> {
  try {
    await fs.mkdir(cacheDir(), { recursive: true });

    const cappedCommits = commits.length > MAX_CACHED_COMMITS
      ? commits.slice(0, MAX_CACHED_COMMITS)
      : commits;

    const cappedNodes: GraphNode[] = layout.nodes.length > cappedCommits.length
      ? layout.nodes.filter(n => n.commitIndex < cappedCommits.length)
      : layout.nodes;

    const cappedLayout: GraphLayoutData = {
      nodes: cappedNodes,
      maxColumns: layout.maxColumns,
      mergeLinks: [],
    };

    const entry: GraphCacheEntry = {
      version: CACHE_VERSION,
      repoPath,
      headHash,
      savedAt: Date.now(),
      commits: cappedCommits,
      layout: cappedLayout,
    };

    const tmp = cacheFile(repoPath) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(entry), 'utf-8');
    await fs.rename(tmp, cacheFile(repoPath));
  } catch {
    // Кэш — best-effort. Падение не должно ломать открытие репо.
  }
}

export async function clearGraphCache(repoPath: string): Promise<void> {
  try {
    await fs.unlink(cacheFile(repoPath));
  } catch {
    // файла могло не быть
  }
}
