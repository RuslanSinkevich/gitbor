import { describe, it, expect } from 'vitest';
import { parseConflictMarkers } from '../../src/core/git/ConflictParser';

describe('parseConflictMarkers', () => {
  it('returns single clean block for no conflicts', () => {
    const blocks = parseConflictMarkers('line1\nline2\nline3');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('clean');
    expect(blocks[0].content).toBe('line1\nline2\nline3');
  });

  it('returns empty for empty string', () => {
    const blocks = parseConflictMarkers('');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('clean');
    expect(blocks[0].content).toBe('');
  });

  it('parses a simple conflict', () => {
    const content = [
      'before',
      '<<<<<<< HEAD',
      'our line',
      '=======',
      'their line',
      '>>>>>>> branch',
      'after',
    ].join('\n');

    const blocks = parseConflictMarkers(content);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ type: 'clean', content: 'before' });
    expect(blocks[1]).toMatchObject({ type: 'conflict', ours: 'our line', theirs: 'their line' });
    expect(blocks[2]).toMatchObject({ type: 'clean', content: 'after' });
  });

  it('parses diff3 format (with base marker)', () => {
    const content = [
      '<<<<<<< HEAD',
      'ours',
      '||||||| base',
      'base content',
      '=======',
      'theirs',
      '>>>>>>> branch',
    ].join('\n');

    const blocks = parseConflictMarkers(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('conflict');
    expect(blocks[0].ours).toBe('ours');
    expect(blocks[0].theirs).toBe('theirs');
  });

  it('handles multiple conflicts', () => {
    const content = [
      'start',
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> x',
      'middle',
      '<<<<<<< HEAD',
      'c',
      '=======',
      'd',
      '>>>>>>> y',
      'end',
    ].join('\n');

    const blocks = parseConflictMarkers(content);
    expect(blocks).toHaveLength(5);
    expect(blocks.filter(b => b.type === 'conflict')).toHaveLength(2);
    expect(blocks.filter(b => b.type === 'clean')).toHaveLength(3);
  });

  it('handles multi-line conflict blocks', () => {
    const content = [
      '<<<<<<< HEAD',
      'our1',
      'our2',
      '=======',
      'their1',
      'their2',
      'their3',
      '>>>>>>> branch',
    ].join('\n');

    const blocks = parseConflictMarkers(content);
    expect(blocks[0].ours).toBe('our1\nour2');
    expect(blocks[0].theirs).toBe('their1\ntheir2\ntheir3');
  });

  it('handles empty ours side', () => {
    const content = [
      '<<<<<<< HEAD',
      '=======',
      'theirs',
      '>>>>>>> branch',
    ].join('\n');

    const blocks = parseConflictMarkers(content);
    expect(blocks[0].ours).toBe('');
    expect(blocks[0].theirs).toBe('theirs');
  });

  it('handles empty theirs side', () => {
    const content = [
      '<<<<<<< HEAD',
      'ours',
      '=======',
      '>>>>>>> branch',
    ].join('\n');

    const blocks = parseConflictMarkers(content);
    expect(blocks[0].ours).toBe('ours');
    expect(blocks[0].theirs).toBe('');
  });

  it('handles CRLF line endings', () => {
    const content = '<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> b\r\n';
    const blocks = parseConflictMarkers(content);
    expect(blocks[0].type).toBe('conflict');
    expect(blocks[0].ours).toBe('ours');
  });

  it('handles file ending mid-conflict (theirs state)', () => {
    const content = [
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
    ].join('\n');

    const blocks = parseConflictMarkers(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('conflict');
  });

  it('handles incomplete conflict (ours state — no splitter)', () => {
    const content = [
      '<<<<<<< HEAD',
      'orphan line',
    ].join('\n');

    const blocks = parseConflictMarkers(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('clean');
    expect(blocks[0].content).toBe('orphan line');
  });

  it('handles conflict at very start of file', () => {
    const content = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b';
    const blocks = parseConflictMarkers(content);
    expect(blocks[0].type).toBe('conflict');
  });

  it('handles conflict at very end of file', () => {
    const content = 'code\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b';
    const blocks = parseConflictMarkers(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].type).toBe('conflict');
  });
});
