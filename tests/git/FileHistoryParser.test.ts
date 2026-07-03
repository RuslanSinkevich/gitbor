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

  // Регрессия: реальный git-вывод — meta\n\nstatus, а между status
  // предыдущего коммита и meta следующего пустой строки НЕТ. Старый
  // split('\n\n')+шаг2 бил hash мусором и терял половину коммитов.
  it('parses real git layout (no blank line between commits)', () => {
    const meta = (h: string, s: string) => ['hash_' + h, h, s, 'Dev', '100'].join(SEP);
    const raw = [
      meta('c1', 'first'),
      '',
      'M\tsrc/app.ts',
      meta('c2', 'second'),
      '',
      'A\tsrc/app.ts',
      meta('c3', 'third'),
      '',
      'M\tsrc/app.ts',
    ].join('\n');

    const entries = parseFileHistory(raw);
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.hash)).toEqual(['hash_c1', 'hash_c2', 'hash_c3']);
    expect(entries.map(e => e.shortHash)).toEqual(['c1', 'c2', 'c3']);
    expect(entries.map(e => e.status)).toEqual(['M', 'A', 'M']);
    // Ни один hash не должен содержать мусор от status-строки.
    for (const e of entries) expect(e.hash).not.toContain('\t');
  });

  it('handles rename name-status (R100\\told\\tnew)', () => {
    const raw = [
      ['hash_r', 'r', 'rename', 'Dev', '100'].join(SEP),
      '',
      'R100\told/path.ts\tnew/path.ts',
    ].join('\n');
    const entries = parseFileHistory(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].hash).toBe('hash_r');
    expect(entries[0].status).toBe('R');
  });
});
