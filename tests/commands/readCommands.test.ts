import { describe, it, expect } from 'vitest';
import { parseRepoStats, parseAuthorCodeStats } from '../../src/core/commands/readCommands';

describe('parseRepoStats', () => {
  it('returns empty stats for empty input', () => {
    const result = parseRepoStats('');
    expect(result.totalCommits).toBe(0);
    expect(result.authors).toHaveLength(0);
    expect(result.monthlyCounts).toHaveLength(0);
  });

  it('parses single author single commit', () => {
    const raw = 'Alice\x00alice@test.com\x002025-03-15T10:00:00+03:00\n';
    const result = parseRepoStats(raw);

    expect(result.totalCommits).toBe(1);
    expect(result.authors).toHaveLength(1);
    expect(result.authors[0].name).toBe('Alice');
    expect(result.authors[0].email).toBe('alice@test.com');
    expect(result.authors[0].commits).toBe(1);
    expect(result.authors[0].percentage).toBe(100);
    expect(result.period.from).toBe('2025-03-15');
    expect(result.period.to).toBe('2025-03-15');
  });

  it('aggregates multiple authors correctly', () => {
    const lines = [
      'Alice\x00alice@test.com\x002025-01-10T10:00:00+00:00',
      'Bob\x00bob@test.com\x002025-01-10T11:00:00+00:00',
      'Alice\x00alice@test.com\x002025-01-11T10:00:00+00:00',
      'Alice\x00alice@test.com\x002025-02-01T10:00:00+00:00',
      'Bob\x00bob@test.com\x002025-02-05T10:00:00+00:00',
    ].join('\n');

    const result = parseRepoStats(lines);
    expect(result.totalCommits).toBe(5);
    expect(result.authors).toHaveLength(2);

    const alice = result.authors.find(a => a.name === 'Alice')!;
    const bob = result.authors.find(a => a.name === 'Bob')!;

    expect(alice.commits).toBe(3);
    expect(bob.commits).toBe(2);
    expect(alice.percentage).toBe(60);
    expect(bob.percentage).toBe(40);

    expect(alice.firstDate).toBe('2025-01-10');
    expect(alice.lastDate).toBe('2025-02-01');
  });

  it('computes monthly counts correctly', () => {
    const lines = [
      'Dev\x00dev@test.com\x002025-01-05T10:00:00+00:00',
      'Dev\x00dev@test.com\x002025-01-15T10:00:00+00:00',
      'Dev\x00dev@test.com\x002025-02-10T10:00:00+00:00',
    ].join('\n');

    const result = parseRepoStats(lines);
    expect(result.monthlyCounts).toHaveLength(2);
    expect(result.monthlyCounts[0]).toEqual({ month: '2025-01', count: 2 });
    expect(result.monthlyCounts[1]).toEqual({ month: '2025-02', count: 1 });
  });

  it('computes daily counts for heatmap', () => {
    const lines = [
      'Dev\x00dev@test.com\x002025-03-01T10:00:00+00:00',
      'Dev\x00dev@test.com\x002025-03-01T12:00:00+00:00',
      'Dev\x00dev@test.com\x002025-03-02T10:00:00+00:00',
    ].join('\n');

    const result = parseRepoStats(lines);
    const dev = result.authors[0];
    expect(dev.dailyCounts['2025-03-01']).toBe(2);
    expect(dev.dailyCounts['2025-03-02']).toBe(1);
    expect(dev.mostActiveDay).toBe('2025-03-01');
  });

  it('sorts authors by commits descending', () => {
    const lines = [
      'Low\x00low@test.com\x002025-01-01T10:00:00+00:00',
      'High\x00high@test.com\x002025-01-01T10:00:00+00:00',
      'High\x00high@test.com\x002025-01-02T10:00:00+00:00',
      'High\x00high@test.com\x002025-01-03T10:00:00+00:00',
    ].join('\n');

    const result = parseRepoStats(lines);
    expect(result.authors[0].name).toBe('High');
    expect(result.authors[1].name).toBe('Low');
  });

  it('skips malformed lines gracefully', () => {
    const lines = [
      'Good\x00good@test.com\x002025-01-01T10:00:00+00:00',
      'bad-line-no-separators',
      'Good\x00good@test.com\x002025-01-02T10:00:00+00:00',
    ].join('\n');

    const result = parseRepoStats(lines);
    expect(result.totalCommits).toBe(2);
  });

  it('computes avgPerWeek', () => {
    const lines = [
      'Dev\x00dev@test.com\x002025-01-01T10:00:00+00:00',
      'Dev\x00dev@test.com\x002025-01-08T10:00:00+00:00',
      'Dev\x00dev@test.com\x002025-01-15T10:00:00+00:00',
      'Dev\x00dev@test.com\x002025-01-22T10:00:00+00:00',
    ].join('\n');

    const result = parseRepoStats(lines);
    const dev = result.authors[0];
    expect(dev.avgPerWeek).toBeGreaterThan(0);
    expect(dev.avgPerWeek).toBeLessThanOrEqual(4);
  });
});

describe('parseAuthorCodeStats', () => {
  const head = 'abc123';

  it('skips SKYFORK commit header lines and aggregates numstat', () => {
    const raw = [
      'SKYFORK1111111111111111111111111111111111',
      '',
      '10\t5\tfoo.ts',
      '1\t1\tbar.ts',
      'SKYFORK2222222222222222222222222222222222',
      '',
      '3\t0\tbaz.ts',
    ].join('\n');

    const stats = parseAuthorCodeStats(raw, 'Dev', 'dev@test.com', head);
    expect(stats.addedLines).toBe(14);
    expect(stats.deletedLines).toBe(6);
    expect(stats.netLines).toBe(8);
    expect(stats.touchedFiles).toBe(3);
    expect(stats.binaryFiles).toBe(0);
  });

  it('counts binary numstat rows', () => {
    const raw = ['SKYFORK' + 'a'.repeat(40), '', '-\t-\timg.png'].join('\n');
    const stats = parseAuthorCodeStats(raw, 'Dev', 'dev@test.com', head);
    expect(stats.binaryFiles).toBe(1);
    expect(stats.touchedFiles).toBe(1);
    expect(stats.addedLines).toBe(0);
    expect(stats.deletedLines).toBe(0);
  });
});
