import { readFileSync, writeFileSync } from 'fs';
import { join, resolve, normalize } from 'path';
import type { ConflictBlock, ConflictContent } from './types';

export type { ConflictBlock, ConflictContent };

const START_MARKER = '<<<<<<<';
const SPLITTER = '=======';
const END_MARKER = '>>>>>>>';

export function parseConflictMarkers(content: string): ConflictBlock[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
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
    if (state === 'clean' && line.startsWith(START_MARKER)) {
      flushClean();
      state = 'ours';
      oursLines = [];
      continue;
    }

    if (state === 'ours' && line.startsWith(START_MARKER)) {
      cleanLines.push(...oursLines);
      flushClean();
      oursLines = [];
      break;
    }

    if (state === 'ours' && line === SPLITTER) {
      state = 'theirs';
      theirsLines = [];
      continue;
    }

    if (state === 'theirs' && line.startsWith(END_MARKER)) {
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

  if (state === 'theirs') {
    blocks.push({
      type: 'conflict',
      content: '',
      ours: oursLines.join('\n'),
      theirs: theirsLines.join('\n'),
    });
  } else if (state === 'ours') {
    cleanLines.push(...oursLines);
    flushClean();
  } else {
    flushClean();
  }

  return blocks;
}

export function readConflictFile(repoPath: string, file: string): ConflictContent {
  const fullPath = resolve(join(repoPath, file));
  if (!fullPath.startsWith(normalize(repoPath))) {
    throw new Error('Path traversal detected');
  }
  const content = readFileSync(fullPath, 'utf-8');
  const blocks = parseConflictMarkers(content);
  return {
    file,
    blocks,
    hasConflicts: blocks.some(b => b.type === 'conflict'),
  };
}

import type { ConflictResolution } from './types';
export type { ConflictResolution };

export function buildResolvedContent(blocks: ConflictBlock[], resolutions: ConflictResolution[]): string {
  const parts: string[] = [];
  let conflictIdx = 0;

  for (const block of blocks) {
    if (block.type === 'clean') {
      parts.push(block.content);
    } else {
      const choice = resolutions[conflictIdx] ?? 'ours';
      switch (choice) {
        case 'ours':
          parts.push(block.ours);
          break;
        case 'theirs':
          parts.push(block.theirs);
          break;
        case 'both-ours-first':
          parts.push(block.ours + (block.ours && block.theirs ? '\n' : '') + block.theirs);
          break;
        case 'both-theirs-first':
          parts.push(block.theirs + (block.ours && block.theirs ? '\n' : '') + block.ours);
          break;
      }
      conflictIdx++;
    }
  }

  return parts.join('\n');
}

export function writeResolvedFile(repoPath: string, file: string, content: string): void {
  const fullPath = resolve(join(repoPath, file));
  if (!fullPath.startsWith(normalize(repoPath))) {
    throw new Error('Path traversal detected');
  }
  writeFileSync(fullPath, content, 'utf-8');
}
