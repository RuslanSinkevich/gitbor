import { resolve, normalize, sep } from 'path';
import { realpathSync } from 'fs';

const isWin = process.platform === 'win32';

/**
 * Validates that `filePath` (relative) stays inside `basePath` after resolution.
 * Handles Windows case-insensitivity and follows symlinks for robust validation.
 * Returns the resolved absolute path or throws on traversal attempt.
 */
export function safePath(basePath: string, filePath: string): string {
  const base = resolve(normalize(basePath)) + sep;
  const full = resolve(base, filePath);

  let actualBase = base;
  let actualFull = full;

  if (isWin) {
    actualBase = base.toLowerCase();
    actualFull = full.toLowerCase();
  }

  if (!actualFull.startsWith(actualBase) && actualFull !== actualBase.slice(0, -1)) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }

  try {
    const realFull = realpathSync.native(full);
    const realBase = realpathSync.native(basePath) + sep;
    let checkFull = realFull;
    let checkBase = realBase;
    if (isWin) {
      checkFull = realFull.toLowerCase();
      checkBase = realBase.toLowerCase();
    }
    if (!checkFull.startsWith(checkBase) && checkFull !== checkBase.slice(0, -1)) {
      throw new Error(`Path traversal via symlink detected: ${filePath}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('traversal')) throw e;
    // File doesn't exist yet (e.g. new file) — pre-symlink check is sufficient
  }

  return full;
}

/** Returns true if `name` contains only safe characters for a filename (no path separators). */
export function isSafeFilename(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name) && !name.includes('..');
}
