import { describe, it, expect } from 'vitest';
import { parseReflog, reflogArgs } from '../../src/core/git/ReflogParser';

const SEP = '<<SEP>>';

describe('reflogArgs', () => {
  it('returns correct args', () => {
    const args = reflogArgs(50);
    expect(args[0]).toBe('reflog');
    expect(args).toContain('-n');
    expect(args).toContain('50');
    expect(args[1]).toContain('--format=');
  });
});

describe('parseReflog', () => {
  it('returns empty for empty input', () => {
    expect(parseReflog('')).toEqual([]);
    expect(parseReflog('  ')).toEqual([]);
  });

  it('parses a checkout entry', () => {
    const line = [
      'abc123full', 'abc123', 'checkout: moving from main to dev', 'HEAD@{0}', '2024-01-15 10:30:00 +0300',
    ].join(SEP);
    const entries = parseReflog(line);
    expect(entries).toHaveLength(1);
    expect(entries[0].hash).toBe('abc123full');
    expect(entries[0].shortHash).toBe('abc123');
    expect(entries[0].action).toBe('checkout');
    expect(entries[0].message).toBe('moving from main to dev');
    expect(entries[0].index).toBe(0);
  });

  it('parses a commit entry', () => {
    const line = ['def', 'de', 'commit: fix bug', 'HEAD@{5}', '2024-01-14'].join(SEP);
    const entries = parseReflog(line);
    expect(entries[0].action).toBe('commit');
    expect(entries[0].message).toBe('fix bug');
    expect(entries[0].index).toBe(5);
  });

  it('handles action without colon', () => {
    const line = ['a', 'b', 'rebase', 'HEAD@{0}', 'date'].join(SEP);
    const entries = parseReflog(line);
    expect(entries[0].action).toBe('rebase');
    expect(entries[0].message).toBe('');
  });

  it('parses multiple entries', () => {
    const lines = [
      ['a', 'a', 'commit: first', 'HEAD@{0}', 'd1'].join(SEP),
      ['b', 'b', 'checkout: to dev', 'HEAD@{1}', 'd2'].join(SEP),
      ['c', 'c', 'merge: branch X', 'HEAD@{2}', 'd3'].join(SEP),
    ].join('\n');
    expect(parseReflog(lines)).toHaveLength(3);
  });

  it('skips malformed lines', () => {
    const lines = [
      'garbage',
      ['a', 'b', 'commit: x', 'HEAD@{0}', 'date'].join(SEP),
    ].join('\n');
    expect(parseReflog(lines)).toHaveLength(1);
  });
});
