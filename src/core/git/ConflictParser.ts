import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface ConflictBlock {
  type: 'clean' | 'conflict';
  content: string;
  ours: string;
  theirs: string;
}

export interface ConflictContent {
  file: string;
  blocks: ConflictBlock[];
  hasConflicts: boolean;
}

const OURS_MARKER = /^<{7}\s/;
const SEPARATOR = /^={7}$/;
const THEIRS_MARKER = /^>{7}\s/;

export function parseConflictMarkers(content: string): ConflictBlock[] {
  const lines = content.split('\n');
  const blocks: ConflictBlock[] = [];

  let cleanLines: string[] = [];
  let oursLines: string[] = [];
  let theirsLines: string[] = [];
  let state: 'clean' | 'ours' | 'theirs' = 'clean';

  const flushClean = () => {
    if (cleanLines.length > 0) {
      blocks.push({ type: 'clean', content: cleanLines.join('\n'), ours: '', theirs: '' });
      cleanLines = [];
    }
  };

  for (const line of lines) {
    if (state === 'clean' && OURS_MARKER.test(line)) {
      flushClean();
      state = 'ours';
      oursLines = [];
      continue;
    }

    if (state === 'ours' && SEPARATOR.test(line)) {
      state = 'theirs';
      theirsLines = [];
      continue;
    }

    if (state === 'theirs' && THEIRS_MARKER.test(line)) {
      blocks.push({
        type: 'conflict',
        content: '',
        ours: oursLines.join('\n'),
        theirs: theirsLines.join('\n'),
      });
      state = 'clean';
      continue;
    }

    switch (state) {
      case 'clean':
        cleanLines.push(line);
        break;
      case 'ours':
        oursLines.push(line);
        break;
      case 'theirs':
        theirsLines.push(line);
        break;
    }
  }

  flushClean();

  return blocks;
}

export function readConflictFile(repoPath: string, file: string): ConflictContent {
  const fullPath = join(repoPath, file);
  const content = readFileSync(fullPath, 'utf-8');
  const blocks = parseConflictMarkers(content);
  return {
    file,
    blocks,
    hasConflicts: blocks.some(b => b.type === 'conflict'),
  };
}

export function buildResolvedContent(blocks: ConflictBlock[], resolutions: ('ours' | 'theirs')[]): string {
  const parts: string[] = [];
  let conflictIdx = 0;

  for (const block of blocks) {
    if (block.type === 'clean') {
      parts.push(block.content);
    } else {
      const choice = resolutions[conflictIdx] ?? 'ours';
      parts.push(choice === 'ours' ? block.ours : block.theirs);
      conflictIdx++;
    }
  }

  return parts.join('\n');
}

export function writeResolvedFile(repoPath: string, file: string, content: string): void {
  const fullPath = join(repoPath, file);
  writeFileSync(fullPath, content, 'utf-8');
}
