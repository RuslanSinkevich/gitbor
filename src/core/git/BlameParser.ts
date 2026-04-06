import type { BlameLine, BlameResult } from './types';

/**
 * Parse output of `git blame --porcelain`.
 * Format: blocks of metadata lines followed by a tab-prefixed content line.
 */
export function parseBlame(stdout: string, filePath: string): BlameResult {
  const lines: BlameLine[] = [];
  const rawLines = stdout.split('\n');

  let hash = '';
  let author = '';
  let authorDate = 0;
  let summary = '';
  let lineNo = 0;

  for (const raw of rawLines) {
    if (!raw) continue;

    // First line of a block: <hash> <orig-line> <final-line> [<num-lines>]
    const headerMatch = raw.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (headerMatch) {
      hash = headerMatch[1];
      lineNo = parseInt(headerMatch[2], 10);
      continue;
    }

    if (raw.startsWith('author ')) {
      author = raw.substring(7);
    } else if (raw.startsWith('author-time ')) {
      authorDate = parseInt(raw.substring(12), 10) * 1000;
    } else if (raw.startsWith('summary ')) {
      summary = raw.substring(8);
    } else if (raw.startsWith('\t')) {
      lines.push({
        hash,
        author,
        authorDate,
        lineNo,
        content: raw.substring(1),
        summary,
      });
      lineNo++;
    }
  }

  return { path: filePath, lines };
}
