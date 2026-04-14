import { resolve, normalize, sep } from 'path';

/**
 * Validates that `filePath` (relative) stays inside `basePath` after resolution.
 * Returns the resolved absolute path or throws on traversal attempt.
 */
export function safePath(basePath: string, filePath: string): string {
  const base = resolve(normalize(basePath)) + sep;
  const full = resolve(base, filePath);
  if (!full.startsWith(base) && full !== base.slice(0, -1)) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  return full;
}

/** Returns true if `name` contains only safe characters for a filename (no path separators). */
export function isSafeFilename(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name) && !name.includes('..');
}
