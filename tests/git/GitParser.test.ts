import { describe, it, expect } from 'vitest';
import {
  parseRefs,
  parseCommits,
  parseBranches,
  parseTags,
  parseStashes,
  parseRemotes,
  parseStatus,
  parseFileChanges,
} from '../../src/core/git/GitParser';

const NUL = '\x00';

describe('parseRefs', () => {
  it('returns empty for empty string', () => {
    expect(parseRefs('')).toEqual([]);
    expect(parseRefs('  ')).toEqual([]);
  });

  it('parses HEAD -> branch', () => {
    const refs = parseRefs('HEAD -> main');
    expect(refs).toEqual([{ name: 'main', type: 'head' }]);
  });

  it('parses bare HEAD', () => {
    expect(parseRefs('HEAD')).toEqual([{ name: 'HEAD', type: 'head' }]);
  });

  it('parses tag', () => {
    expect(parseRefs('tag: v1.0')).toEqual([{ name: 'v1.0', type: 'tag' }]);
  });

  it('parses remote', () => {
    expect(parseRefs('origin/main')).toEqual([{ name: 'origin/main', type: 'remote' }]);
  });

  it('parses local branch (no slash)', () => {
    expect(parseRefs('feature')).toEqual([{ name: 'feature', type: 'branch' }]);
  });

  it('parses multiple refs', () => {
    const refs = parseRefs('HEAD -> main, origin/main, tag: v2.0');
    expect(refs).toHaveLength(3);
    expect(refs[0]).toEqual({ name: 'main', type: 'head' });
    expect(refs[1]).toEqual({ name: 'origin/main', type: 'remote' });
    expect(refs[2]).toEqual({ name: 'v2.0', type: 'tag' });
  });
});

describe('parseCommits', () => {
  it('returns empty for empty input', () => {
    expect(parseCommits('')).toEqual([]);
    expect(parseCommits('  \n  ')).toEqual([]);
  });

  it('parses a single commit', () => {
    const line = ['abc123', 'def456', 'Alice', 'alice@x.com', '1700000000', 'HEAD -> main', 'Initial commit', 'N'].join(NUL);
    const commits = parseCommits(line);
    expect(commits).toHaveLength(1);
    expect(commits[0].hash).toBe('abc123');
    expect(commits[0].parents).toEqual(['def456']);
    expect(commits[0].authorName).toBe('Alice');
    expect(commits[0].authorEmail).toBe('alice@x.com');
    expect(commits[0].authorDate).toBe(1700000000000);
    expect(commits[0].subject).toBe('Initial commit');
    expect(commits[0].gpgStatus).toBeUndefined();
  });

  it('parses GPG status G (good)', () => {
    const line = ['abc', '', 'Bob', 'bob@x', '100', '', 'signed', 'G'].join(NUL);
    const commits = parseCommits(line);
    expect(commits[0].gpgStatus).toBe('G');
  });

  it('skips GPG status N (none)', () => {
    const line = ['abc', '', 'Bob', 'bob@x', '100', '', 'unsigned', 'N'].join(NUL);
    expect(parseCommits(line)[0].gpgStatus).toBeUndefined();
  });

  it('handles multiple parents', () => {
    const line = ['abc', 'p1 p2 p3', 'A', 'a@x', '0', '', 'merge'].join(NUL);
    expect(parseCommits(line)[0].parents).toEqual(['p1', 'p2', 'p3']);
  });

  it('handles no parents (root commit)', () => {
    const line = ['abc', '', 'A', 'a@x', '0', '', 'root'].join(NUL);
    expect(parseCommits(line)[0].parents).toEqual([]);
  });

  it('skips lines with too few fields', () => {
    expect(parseCommits('short\x00line')).toEqual([]);
  });

  it('parses multiple commits', () => {
    const lines = [
      ['a1', '', 'A', 'a@x', '100', '', 'first'].join(NUL),
      ['a2', 'a1', 'B', 'b@x', '200', '', 'second'].join(NUL),
    ].join('\n');
    expect(parseCommits(lines)).toHaveLength(2);
  });
});

describe('parseBranches', () => {
  it('returns empty for empty input', () => {
    expect(parseBranches('')).toEqual([]);
  });

  it('parses local branches', () => {
    const input = ['main', 'abc123', 'origin/main', '*'].join(NUL);
    const branches = parseBranches(input);
    expect(branches).toHaveLength(1);
    expect(branches[0].name).toBe('main');
    expect(branches[0].hash).toBe('abc123');
    expect(branches[0].upstream).toBe('origin/main');
    expect(branches[0].isCurrent).toBe(true);
    expect(branches[0].isRemote).toBe(false);
  });

  it('marks remote branches', () => {
    const input = ['origin/main', 'abc'].join(NUL);
    const branches = parseBranches(input, true);
    expect(branches[0].isRemote).toBe(true);
  });

  it('handles missing upstream', () => {
    const input = ['dev', 'abc', '', ''].join(NUL);
    const branches = parseBranches(input);
    expect(branches[0].upstream).toBeUndefined();
    expect(branches[0].isCurrent).toBe(false);
  });
});

describe('parseTags', () => {
  it('returns empty for empty input', () => {
    expect(parseTags('')).toEqual([]);
  });

  it('parses tags', () => {
    const input = ['v1.0', 'abc123'].join(NUL) + '\n' + ['v2.0', 'def456'].join(NUL);
    const tags = parseTags(input);
    expect(tags).toHaveLength(2);
    expect(tags[0]).toEqual({ name: 'v1.0', hash: 'abc123' });
    expect(tags[1]).toEqual({ name: 'v2.0', hash: 'def456' });
  });

  it('skips lines with missing name', () => {
    const input = ['', 'abc'].join(NUL);
    expect(parseTags(input)).toEqual([]);
  });
});

describe('parseStashes', () => {
  it('returns empty for empty input', () => {
    expect(parseStashes('')).toEqual([]);
  });

  it('parses stash entries', () => {
    const input = ['stash@{0}', 'abc', 'WIP on main'].join(NUL);
    const stashes = parseStashes(input);
    expect(stashes).toHaveLength(1);
    expect(stashes[0]).toEqual({ index: 'stash@{0}', hash: 'abc', message: 'WIP on main' });
  });
});

describe('parseRemotes', () => {
  it('returns empty for empty input', () => {
    expect(parseRemotes('')).toEqual([]);
  });

  it('parses fetch and push URLs', () => {
    const input = [
      'origin\tgit@github.com:user/repo.git (fetch)',
      'origin\tgit@github.com:user/repo.git (push)',
    ].join('\n');
    const remotes = parseRemotes(input);
    expect(remotes).toHaveLength(1);
    expect(remotes[0].name).toBe('origin');
    expect(remotes[0].fetchUrl).toBe('git@github.com:user/repo.git');
    expect(remotes[0].pushUrl).toBe('git@github.com:user/repo.git');
  });

  it('handles multiple remotes', () => {
    const input = [
      'origin\thttps://github.com/a/b.git (fetch)',
      'origin\thttps://github.com/a/b.git (push)',
      'upstream\thttps://github.com/c/d.git (fetch)',
      'upstream\thttps://github.com/c/d.git (push)',
    ].join('\n');
    expect(parseRemotes(input)).toHaveLength(2);
  });
});

describe('parseStatus', () => {
  it('returns empty for empty input', () => {
    expect(parseStatus('')).toEqual([]);
    expect(parseStatus('  ')).toEqual([]);
  });

  it('parses staged modification', () => {
    const result = parseStatus('M  src/app.ts\n');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'src/app.ts', status: 'M', staged: true });
  });

  it('parses unstaged modification', () => {
    const result = parseStatus(' M src/app.ts\n');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'src/app.ts', status: 'M', staged: false });
  });

  it('parses both staged and unstaged for same file', () => {
    const result = parseStatus('MM src/app.ts\n');
    expect(result).toHaveLength(2);
    expect(result[0].staged).toBe(true);
    expect(result[1].staged).toBe(false);
  });

  it('parses untracked files', () => {
    const result = parseStatus('?? new-file.ts\n');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'new-file.ts', status: '?', staged: false });
  });

  it('parses staged addition', () => {
    const result = parseStatus('A  added.ts\n');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'added.ts', status: 'A', staged: true });
  });

  it('parses staged deletion', () => {
    const result = parseStatus('D  removed.ts\n');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'removed.ts', status: 'D', staged: true });
  });

  it('parses conflict (UU)', () => {
    const result = parseStatus('UU conflict.ts\n');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'conflict.ts', status: 'U', staged: false });
  });

  it('parses conflict (AA)', () => {
    const result = parseStatus('AA both-added.ts\n');
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('U');
  });

  it('handles multiple files', () => {
    const input = 'M  a.ts\n M b.ts\n?? c.ts\nA  d.ts\n';
    const result = parseStatus(input);
    expect(result).toHaveLength(4);
  });
});

describe('parseFileChanges', () => {
  it('returns empty for empty input', () => {
    expect(parseFileChanges('')).toEqual([]);
  });

  it('parses simple changes', () => {
    const input = 'M\tsrc/app.ts\nA\tsrc/new.ts\nD\tsrc/old.ts';
    const changes = parseFileChanges(input);
    expect(changes).toHaveLength(3);
    expect(changes[0]).toEqual({ status: 'M', path: 'src/app.ts' });
    expect(changes[1]).toEqual({ status: 'A', path: 'src/new.ts' });
    expect(changes[2]).toEqual({ status: 'D', path: 'src/old.ts' });
  });

  it('parses rename', () => {
    const input = 'R100\told.ts\tnew.ts';
    const changes = parseFileChanges(input);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ status: 'R', path: 'new.ts', oldPath: 'old.ts' });
  });

  it('parses copy', () => {
    const input = 'C100\tsrc.ts\tcopy.ts';
    const changes = parseFileChanges(input);
    expect(changes[0]).toEqual({ status: 'C', path: 'copy.ts', oldPath: 'src.ts' });
  });
});
