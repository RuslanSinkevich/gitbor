import { describe, it, expect } from 'vitest';
import { parseRemoteOnlyHashes } from '../../src/core/state/remoteOnly';

describe('parseRemoteOnlyHashes', () => {
  it('returns empty set on empty input', () => {
    expect(parseRemoteOnlyHashes('').size).toBe(0);
  });

  it('returns empty set on whitespace-only input', () => {
    expect(parseRemoteOnlyHashes('   \n  \n\n\t').size).toBe(0);
  });

  it('parses a single hash without trailing newline', () => {
    const r = parseRemoteOnlyHashes('abc123');
    expect(r.size).toBe(1);
    expect(r.has('abc123')).toBe(true);
  });

  it('parses multiple hashes split by \\n with trailing newline', () => {
    const r = parseRemoteOnlyHashes('aaa\nbbb\nccc\n');
    expect(r.size).toBe(3);
    expect(r.has('aaa')).toBe(true);
    expect(r.has('bbb')).toBe(true);
    expect(r.has('ccc')).toBe(true);
  });

  it('strips CR endings (Windows-style CRLF)', () => {
    const r = parseRemoteOnlyHashes('aaa\r\nbbb\r\n');
    expect(r.size).toBe(2);
    expect(r.has('aaa')).toBe(true);
    expect(r.has('bbb')).toBe(true);
  });

  it('filters empty / whitespace lines between hashes', () => {
    const r = parseRemoteOnlyHashes('aaa\n\n   \nbbb\n');
    expect(r.size).toBe(2);
    expect(r.has('aaa')).toBe(true);
    expect(r.has('bbb')).toBe(true);
  });

  it('deduplicates identical hashes (set semantics)', () => {
    const r = parseRemoteOnlyHashes('aaa\naaa\naaa');
    expect(r.size).toBe(1);
    expect(r.has('aaa')).toBe(true);
  });

  it('does not throw on unusual input shapes', () => {
    expect(() => parseRemoteOnlyHashes('not-a-hash but ok')).not.toThrow();
    const r = parseRemoteOnlyHashes('not-a-hash but ok');
    expect(r.has('not-a-hash but ok')).toBe(true);
  });
});
