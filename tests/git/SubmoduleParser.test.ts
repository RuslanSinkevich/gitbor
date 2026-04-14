import { describe, it, expect } from 'vitest';
import { parseSubmoduleStatus, parseGitmodules } from '../../src/core/git/SubmoduleParser';

describe('parseSubmoduleStatus', () => {
  it('returns empty for empty input', () => {
    expect(parseSubmoduleStatus('')).toEqual([]);
  });

  it('parses clean submodule', () => {
    // Real git output has multiple lines; leading space on single line gets trimmed
    const raw = ' abc1234 vendor/lib (v1.0)\n+def5678 vendor/other (v2.0)';
    const subs = parseSubmoduleStatus(raw);
    expect(subs).toHaveLength(2);
    expect(subs[0].name).toBe('lib');
    expect(subs[0].path).toBe('vendor/lib');
    expect(subs[0].status).toBe('clean');
    expect(subs[1].status).toBe('modified');
  });

  it('parses modified submodule', () => {
    const raw = '+abc1234 vendor/lib (v1.0)';
    expect(parseSubmoduleStatus(raw)[0].status).toBe('modified');
  });

  it('parses uninitialized submodule', () => {
    const raw = '-abc1234 vendor/lib';
    expect(parseSubmoduleStatus(raw)[0].status).toBe('uninitialized');
  });

  it('parses multiple submodules', () => {
    const raw = ' abc lib1 (v1)\n+def lib2 (v2)\n-ghi lib3';
    expect(parseSubmoduleStatus(raw)).toHaveLength(3);
  });
});

describe('parseGitmodules', () => {
  it('returns empty map for empty input', () => {
    expect(parseGitmodules('').size).toBe(0);
  });

  it('parses path and url pairs', () => {
    const raw = [
      'submodule.mylib.path=vendor/mylib',
      'submodule.mylib.url=https://github.com/user/mylib.git',
    ].join('\n');
    const map = parseGitmodules(raw);
    expect(map.size).toBe(1);
    expect(map.get('vendor/mylib')).toBe('https://github.com/user/mylib.git');
  });

  it('handles multiple submodules', () => {
    const raw = [
      'submodule.a.path=libs/a',
      'submodule.a.url=https://example.com/a',
      'submodule.b.path=libs/b',
      'submodule.b.url=https://example.com/b',
    ].join('\n');
    const map = parseGitmodules(raw);
    expect(map.size).toBe(2);
  });

  it('ignores entries without matching url', () => {
    const raw = 'submodule.orphan.path=libs/orphan';
    expect(parseGitmodules(raw).size).toBe(0);
  });
});
