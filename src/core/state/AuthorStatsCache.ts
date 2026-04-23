import { app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AuthorCodeStats } from '../bridge/messages';

const CACHE_VERSION = 1;

interface AuthorStatsCacheEntry {
  version: number;
  repoPath: string;
  authorName: string;
  authorEmail: string;
  headHash: string;
  savedAt: number;
  stats: AuthorCodeStats;
}

function repoKey(repoPath: string): string {
  return crypto.createHash('sha1').update(repoPath).digest('hex').slice(0, 16);
}

function authorKey(authorName: string, authorEmail: string): string {
  return crypto.createHash('sha1').update(`${authorName}\x00${authorEmail}`).digest('hex').slice(0, 16);
}

function cacheRoot(): string {
  return path.join(app.getPath('userData'), 'stats-cache');
}

function repoCacheDir(repoPath: string): string {
  return path.join(cacheRoot(), repoKey(repoPath));
}

function cacheFile(repoPath: string, authorName: string, authorEmail: string): string {
  return path.join(repoCacheDir(repoPath), `${authorKey(authorName, authorEmail)}.json`);
}

export async function loadAuthorStatsCache(
  repoPath: string,
  authorName: string,
  authorEmail: string,
  headHash: string,
): Promise<AuthorCodeStats | null> {
  try {
    const raw = await fs.readFile(cacheFile(repoPath, authorName, authorEmail), 'utf-8');
    const entry = JSON.parse(raw) as AuthorStatsCacheEntry;
    if (entry.version !== CACHE_VERSION) return null;
    if (entry.repoPath !== repoPath) return null;
    if (entry.authorName !== authorName || entry.authorEmail !== authorEmail) return null;
    if (entry.headHash !== headHash) return null;
    return entry.stats;
  } catch {
    return null;
  }
}

export async function saveAuthorStatsCache(
  repoPath: string,
  stats: AuthorCodeStats,
): Promise<void> {
  try {
    await fs.mkdir(repoCacheDir(repoPath), { recursive: true });
    const entry: AuthorStatsCacheEntry = {
      version: CACHE_VERSION,
      repoPath,
      authorName: stats.authorName,
      authorEmail: stats.authorEmail,
      headHash: stats.headHash,
      savedAt: Date.now(),
      stats,
    };
    const target = cacheFile(repoPath, stats.authorName, stats.authorEmail);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entry), 'utf-8');
    await fs.rename(tmp, target);
  } catch {
    // best-effort cache
  }
}
