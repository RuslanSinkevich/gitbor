import { describe, it, expect } from 'vitest';
import { parseBlame } from '../../src/core/git/BlameParser';

describe('parseBlame', () => {
  it('returns empty for empty input', () => {
    const result = parseBlame('', 'file.ts');
    expect(result.path).toBe('file.ts');
    expect(result.lines).toEqual([]);
  });

  it('parses a single blame block', () => {
    const raw = [
      'abcdef1234567890abcdef1234567890abcdef12 1 1 1',
      'author Alice',
      'author-time 1700000000',
      'summary Initial commit',
      '\tconst x = 1;',
    ].join('\n');

    const result = parseBlame(raw, 'test.ts');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].hash).toBe('abcdef1234567890abcdef1234567890abcdef12');
    expect(result.lines[0].author).toBe('Alice');
    expect(result.lines[0].authorDate).toBe(1700000000000);
    expect(result.lines[0].lineNo).toBe(1);
    expect(result.lines[0].content).toBe('const x = 1;');
    expect(result.lines[0].summary).toBe('Initial commit');
  });

  it('parses multiple blame lines', () => {
    const raw = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1',
      'author Bob',
      'author-time 100',
      'summary first',
      '\tline one',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2 2',
      'author Bob',
      'author-time 100',
      'summary first',
      '\tline two',
    ].join('\n');

    const result = parseBlame(raw, 'f.ts');
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].content).toBe('line one');
    expect(result.lines[1].content).toBe('line two');
    expect(result.lines[1].lineNo).toBe(2);
  });

  it('handles empty content lines (tab only)', () => {
    const raw = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1',
      'author X',
      'author-time 0',
      'summary s',
      '\t',
    ].join('\n');

    const result = parseBlame(raw, 'f');
    expect(result.lines[0].content).toBe('');
  });
});
