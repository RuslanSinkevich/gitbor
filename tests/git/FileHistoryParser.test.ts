import { describe, it, expect } from 'vitest';
import { parseFileHistory } from '../../src/core/git/FileHistoryParser';

const SEP = '\x00';

describe('parseFileHistory', () => {
  it('returns empty for empty input', () => {
    expect(parseFileHistory('')).toEqual([]);
  });

  it('parses a single entry', () => {
    const raw = [
      ['abc', 'ab', 'fix bug', 'Alice', '1700000000'].join(SEP),
      'M\tsrc/app.ts',
    ].join('\n\n');

    const entries = parseFileHistory(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].hash).toBe('abc');
    expect(entries[0].shortHash).toBe('ab');
    expect(entries[0].subject).toBe('fix bug');
    expect(entries[0].authorName).toBe('Alice');
    expect(entries[0].authorDate).toBe(1700000000000);
    expect(entries[0].status).toBe('M');
  });

  it('parses multiple entries', () => {
    const entry1 = ['a1', 'a', 'first', 'X', '100'].join(SEP) + '\n\n' + 'A\tfile.ts';
    const entry2 = ['a2', 'b', 'second', 'Y', '200'].join(SEP) + '\n\n' + 'M\tfile.ts';
    const raw = entry1 + '\n\n' + entry2;

    const entries = parseFileHistory(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0].status).toBe('A');
    expect(entries[1].status).toBe('M');
  });

  it('defaults status to M when missing', () => {
    const raw = ['abc', 'ab', 'msg', 'A', '100'].join(SEP);
    const entries = parseFileHistory(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('M');
  });
});
