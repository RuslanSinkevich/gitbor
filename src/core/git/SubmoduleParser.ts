import type { Submodule } from './types';

/**
 * Parse output of `git submodule status`.
 * Format per line: [+-U ]<hash> <path> (<describe>)
 * - ' ' = clean, '+' = modified, '-' = uninitialized, 'U' = merge conflict
 */
export function parseSubmoduleStatus(stdout: string): Submodule[] {
  const result: Submodule[] = [];
  for (const line of stdout.trim().split('\n')) {
    if (!line.trim()) continue;

    const statusChar = line.charAt(0);
    const rest = line.substring(1).trim();
    const parts = rest.split(/\s+/);
    if (parts.length < 2) continue;

    const hash = parts[0];
    const path = parts[1];
    const name = path.split('/').pop() || path;

    let status: Submodule['status'] = 'clean';
    if (statusChar === '+') status = 'modified';
    else if (statusChar === '-') status = 'uninitialized';

    result.push({ name, path, url: '', hash, status });
  }
  return result;
}

/**
 * Parse output of `git config --file .gitmodules --list`.
 * Format: submodule.<name>.path=<value>\nsubmodule.<name>.url=<value>
 * Returns a map of path -> url.
 */
export function parseGitmodules(content: string): Map<string, string> {
  const pathMap = new Map<string, string>();
  const urlMap = new Map<string, string>();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const pathMatch = trimmed.match(/^submodule\.(.+)\.path=(.+)$/);
    if (pathMatch) {
      pathMap.set(pathMatch[1], pathMatch[2]);
      continue;
    }

    const urlMatch = trimmed.match(/^submodule\.(.+)\.url=(.+)$/);
    if (urlMatch) {
      urlMap.set(urlMatch[1], urlMatch[2]);
    }
  }

  const result = new Map<string, string>();
  for (const [name, path] of pathMap) {
    const url = urlMap.get(name);
    if (url) result.set(path, url);
  }

  return result;
}
