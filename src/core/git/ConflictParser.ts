import { readFileSync, writeFileSync } from 'fs';
import type { ConflictBlock, ConflictContent } from './types';
import { safePath } from '../utils/pathSecurity';

export type { ConflictBlock, ConflictContent };

/**
 * State machine for parsing git conflict markers.
 * Supports both standard and diff3 format (||||||| base marker).
 */
type ParserState = 'clean' | 'ours' | 'base' | 'theirs';

export function parseConflictMarkers(content: string): ConflictBlock[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks: ConflictBlock[] = [];

  let cleanLines: string[] = [];
  let oursLines: string[] = [];
  let theirsLines: string[] = [];
  let state: ParserState = 'clean';

  const flushClean = () => {
    if (cleanLines.length > 0) {
      blocks.push({ type: 'clean', content: cleanLines.join('\n'), ours: '', theirs: '' });
      cleanLines = [];
    }
  };

  const flushConflict = () => {
    blocks.push({
      type: 'conflict',
      content: '',
      ours: oursLines.join('\n'),
      theirs: theirsLines.join('\n'),
    });
    oursLines = [];
    theirsLines = [];
  };

  for (const line of lines) {
    if (state === 'clean' && line.startsWith('<<<<<<<')) {
      flushClean();
      state = 'ours';
      oursLines = [];
      continue;
    }

    if ((state === 'ours' || state === 'base') && line.startsWith('|||||||')) {
      state = 'base';
      continue;
    }

    if ((state === 'ours' || state === 'base') && line.startsWith('=======')) {
      state = 'theirs';
      theirsLines = [];
      continue;
    }

    if (state === 'theirs' && line.startsWith('>>>>>>>')) {
      flushConflict();
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
      case 'base':
        break;
      case 'theirs':
        theirsLines.push(line);
        break;
    }
  }

  if (state === 'theirs') {
    flushConflict();
  } else if (state === 'ours' || state === 'base') {
    cleanLines.push(...oursLines);
    flushClean();
  } else {
    flushClean();
  }

  return blocks;
}

export function readConflictFile(repoPath: string, file: string): ConflictContent {
  const fullPath = safePath(repoPath, file);
  const content = readFileSync(fullPath, 'utf-8');
  const blocks = parseConflictMarkers(content);
  return {
    file,
    blocks,
    hasConflicts: blocks.some(b => b.type === 'conflict'),
  };
}

export function writeResolvedFile(repoPath: string, file: string, content: string): void {
  const fullPath = safePath(repoPath, file);
  writeFileSync(fullPath, content, 'utf-8');
}
