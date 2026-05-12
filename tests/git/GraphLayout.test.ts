import { describe, it, expect } from 'vitest';
import { computeGraphLayout } from '../../src/core/git/GraphLayout';
import type { Commit } from '../../src/core/git/types';

function makeCommit(hash: string, parents: string[], subject = '', isRemoteOnly = false): Commit {
  return { hash, parents, authorName: 'A', authorEmail: 'a@x', authorDate: 0, refs: [], subject, isRemoteOnly };
}

describe('computeGraphLayout', () => {
  it('returns empty for no commits', () => {
    const result = computeGraphLayout([]);
    expect(result.nodes).toEqual([]);
    expect(result.maxColumns).toBe(0);
    expect(result.mergeLinks).toEqual([]);
  });

  it('assigns column to single commit', () => {
    const commits = [makeCommit('a', [])];
    const result = computeGraphLayout(commits);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].column).toBe(0);
    expect(result.nodes[0].color).toBeDefined();
  });

  it('handles linear chain', () => {
    const commits = [
      makeCommit('c', ['b']),
      makeCommit('b', ['a']),
      makeCommit('a', []),
    ];
    const result = computeGraphLayout(commits);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0].column).toBe(0);
    expect(result.nodes[1].column).toBe(0);
    expect(result.nodes[2].column).toBe(0);
  });

  it('handles simple branch/merge', () => {
    const commits = [
      makeCommit('m', ['a', 'b']),
      makeCommit('a', ['root']),
      makeCommit('b', ['root']),
      makeCommit('root', []),
    ];
    const result = computeGraphLayout(commits);
    expect(result.nodes).toHaveLength(4);
    expect(result.maxColumns).toBeGreaterThanOrEqual(1);
  });

  it('assigns unique colors per lane', () => {
    const commits = [
      makeCommit('m', ['a', 'b']),
      makeCommit('a', ['root']),
      makeCommit('b', ['root']),
      makeCommit('root', []),
    ];
    const result = computeGraphLayout(commits);
    const colors = new Set(result.nodes.map(n => n.color));
    expect(colors.size).toBeGreaterThanOrEqual(1);
  });

  it('handles parent not in commit list', () => {
    const commits = [makeCommit('a', ['unknown-parent'])];
    const result = computeGraphLayout(commits);
    expect(result.nodes).toHaveLength(1);
  });

  it('handles 10+ commits without crashing', () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 20; i++) {
      commits.push(makeCommit(`c${i}`, i < 19 ? [`c${i + 1}`] : []));
    }
    const result = computeGraphLayout(commits);
    expect(result.nodes).toHaveLength(20);
  });

  describe('isRemoteOnly propagation', () => {
    it('defaults to false on all nodes when no commit is marked', () => {
      const commits = [
        makeCommit('c', ['b']),
        makeCommit('b', ['a']),
        makeCommit('a', []),
      ];
      const result = computeGraphLayout(commits);
      expect(result.nodes.every(n => n.isRemoteOnly === false)).toBe(true);
    });

    it('mirrors Commit.isRemoteOnly into GraphNode.isRemoteOnly index-by-index', () => {
      const commits = [
        makeCommit('c', ['b'], '', false),
        makeCommit('b', ['a'], '', true),
        makeCommit('a', [], '', true),
      ];
      const result = computeGraphLayout(commits);
      expect(result.nodes[0].isRemoteOnly).toBe(false);
      expect(result.nodes[1].isRemoteOnly).toBe(true);
      expect(result.nodes[2].isRemoteOnly).toBe(true);
    });

    it('marks remote-only flag for a mixed set with branch/merge topology', () => {
      const commits = [
        makeCommit('m', ['a', 'b'], '', false),
        makeCommit('a', ['root'], '', true),
        makeCommit('b', ['root'], '', false),
        makeCommit('root', [], '', false),
      ];
      const result = computeGraphLayout(commits);
      expect(result.nodes.map(n => n.isRemoteOnly)).toEqual([false, true, false, false]);
    });
  });
});
