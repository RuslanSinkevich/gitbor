import type { FileHistoryEntry } from './types';

const SEPARATOR = '\x00';
const FORMAT = ['%H', '%h', '%s', '%an', '%at'].join('%x00');

export { FORMAT as FILE_HISTORY_FORMAT };

/**
 * Parse output of `git log --follow --format=<FORMAT> --name-status -- <file>`.
 * FORMAT uses `%x00` field separators (NUL in stdout only; avoids NUL in process argv).
 * Each entry is: hash\0shortHash\0subject\0author\0timestamp\n\nSTATUS\tPATH
 */
export function parseFileHistory(stdout: string): FileHistoryEntry[] {
  const entries: FileHistoryEntry[] = [];
  const blocks = stdout.trim().split('\n\n');

  for (let i = 0; i < blocks.length; i += 2) {
    const metaLine = blocks[i]?.trim();
    const statusLine = blocks[i + 1]?.trim();
    if (!metaLine) continue;

    const parts = metaLine.split(SEPARATOR);
    if (parts.length < 5) continue;

    const status = statusLine?.charAt(0) || 'M';

    entries.push({
      hash: parts[0],
      shortHash: parts[1],
      subject: parts[2],
      authorName: parts[3],
      authorDate: parseInt(parts[4], 10) * 1000,
      status,
    });
  }

  return entries;
}
