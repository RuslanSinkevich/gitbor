import { resolve, normalize, sep } from 'path';
import { realpathSync } from 'fs';

/**
 * Считается ли FS на текущей платформе case-insensitive по умолчанию.
 * - Windows (NTFS) — да.
 * - macOS (APFS/HFS+) — да по умолчанию (можно отформатировать как case-sensitive,
 *   но дефолт у пользователей именно case-insensitive).
 * - Linux (ext4/btrfs/xfs) — нет.
 *
 * Читаем `process.platform` при каждом вызове, а не на module-level: тесты
 * мокают platform через `Object.defineProperty(process, 'platform', ...)`.
 */
function isCaseInsensitiveFs(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

/**
 * Validates that `filePath` (relative) stays inside `basePath` after resolution.
 * Handles Windows/macOS case-insensitivity and follows symlinks for robust validation.
 * Returns the resolved absolute path or throws on traversal attempt.
 */
export function safePath(basePath: string, filePath: string): string {
  const base = resolve(normalize(basePath)) + sep;
  const full = resolve(base, filePath);

  let actualBase = base;
  let actualFull = full;

  if (isCaseInsensitiveFs()) {
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
    if (isCaseInsensitiveFs()) {
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
