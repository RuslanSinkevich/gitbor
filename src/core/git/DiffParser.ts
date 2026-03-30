import type { DiffLine, DiffHunk, FileDiff } from './types';

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;
const DIFF_FILE_RE = /^diff --git a\/(.+?) b\/(.+)$/;

export function parseDiff(stdout: string): FileDiff[] {
  const files: FileDiff[] = [];
  const rawFiles = stdout.split(/(?=^diff --git )/m);

  for (const raw of rawFiles) {
    if (!raw.trim()) continue;

    const fileMatch = raw.match(DIFF_FILE_RE);
    if (!fileMatch) continue;

    const oldPath = fileMatch[1];
    const newPath = fileMatch[2];
    const isBinary = raw.includes('Binary files');

    let status: FileDiff['status'] = 'modified';
    if (raw.includes('new file mode')) status = 'added';
    else if (raw.includes('deleted file mode')) status = 'deleted';
    else if (raw.includes('rename from')) status = 'renamed';
    else if (raw.includes('copy from')) status = 'copied';

    const hunks: DiffHunk[] = [];

    if (!isBinary) {
      const lines = raw.split('\n');
      let currentHunk: DiffHunk | null = null;
      let oldLine = 0;
      let newLine = 0;

      for (const line of lines) {
        const hunkMatch = line.match(HUNK_HEADER_RE);
        if (hunkMatch) {
          currentHunk = {
            header: line,
            oldStart: parseInt(hunkMatch[1], 10),
            oldCount: parseInt(hunkMatch[2] ?? '1', 10),
            newStart: parseInt(hunkMatch[3], 10),
            newCount: parseInt(hunkMatch[4] ?? '1', 10),
            lines: [],
          };
          oldLine = currentHunk.oldStart;
          newLine = currentHunk.newStart;
          hunks.push(currentHunk);
          continue;
        }

        if (!currentHunk) continue;

        let diffLine: DiffLine | null = null;
        if (line.startsWith('+')) {
          diffLine = { type: 'add', content: line.substring(1), oldLineNo: null, newLineNo: newLine++ };
        } else if (line.startsWith('-')) {
          diffLine = { type: 'remove', content: line.substring(1), oldLineNo: oldLine++, newLineNo: null };
        } else if (line.startsWith(' ')) {
          diffLine = { type: 'context', content: line.substring(1), oldLineNo: oldLine++, newLineNo: newLine++ };
        } else if (line === '\\ No newline at end of file') {
          continue;
        }

        if (diffLine) {
          (currentHunk.lines as DiffLine[]).push(diffLine);
        }
      }
    }

    files.push({
      path: newPath,
      oldPath: oldPath !== newPath ? oldPath : undefined,
      status,
      hunks,
      isBinary,
    });
  }

  return files;
}
