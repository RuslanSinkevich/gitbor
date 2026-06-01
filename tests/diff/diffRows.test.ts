import { describe, it, expect } from 'vitest';
import { buildSideRows, maxRowContentLength } from '../../src/renderer/src/features/diff/diffRows';
import type { DiffHunk, DiffLine } from '../../src/core/git/types';

function ctx(content: string, o: number, n: number): DiffLine {
  return { type: 'context', content, oldLineNo: o, newLineNo: n };
}
function rem(content: string, o: number): DiffLine {
  return { type: 'remove', content, oldLineNo: o, newLineNo: null };
}
function add(content: string, n: number): DiffLine {
  return { type: 'add', content, oldLineNo: null, newLineNo: n };
}
function hunk(lines: DiffLine[]): DiffHunk {
  return { header: '@@', oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines };
}

describe('buildSideRows', () => {
  it('pairs removes with adds line-by-line', () => {
    const rows = buildSideRows([hunk([
      ctx('a', 1, 1),
      rem('b', 2),
      add('B', 2),
      rem('c', 3),
      add('C', 3),
      add('D', 4),
      ctx('e', 4, 5),
    ])]);

    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      left: { lineNo: 1, content: 'a', type: 'context' },
      right: { lineNo: 1, content: 'a', type: 'context' },
    });
    expect(rows[1]).toEqual({
      left: { lineNo: 2, content: 'b', type: 'remove' },
      right: { lineNo: 2, content: 'B', type: 'add' },
    });
    expect(rows[2]).toEqual({
      left: { lineNo: 3, content: 'c', type: 'remove' },
      right: { lineNo: 3, content: 'C', type: 'add' },
    });
    // adds > removes → лишнее добавление встаёт напротив пустой ячейки
    expect(rows[3]).toEqual({
      left: { lineNo: null, content: '', type: 'empty' },
      right: { lineNo: 4, content: 'D', type: 'add' },
    });
    expect(rows[4].left.type).toBe('context');
  });

  it('pads the side with fewer lines when removes > adds', () => {
    const rows = buildSideRows([hunk([
      rem('x', 1),
      rem('y', 2),
      add('Y', 1),
    ])]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      left: { lineNo: 1, content: 'x', type: 'remove' },
      right: { lineNo: 1, content: 'Y', type: 'add' },
    });
    expect(rows[1]).toEqual({
      left: { lineNo: 2, content: 'y', type: 'remove' },
      right: { lineNo: null, content: '', type: 'empty' },
    });
  });

  it('flushes pending pairs across hunk boundaries', () => {
    const rows = buildSideRows([
      hunk([rem('a', 1)]),
      hunk([add('B', 1)]),
    ]);
    // Разные hunks: удаление из первого не паруется с добавлением второго —
    // каждый flush'ится в конце своего hunk.
    expect(rows).toHaveLength(2);
    expect(rows[0].left.type).toBe('remove');
    expect(rows[0].right.type).toBe('empty');
    expect(rows[1].left.type).toBe('empty');
    expect(rows[1].right.type).toBe('add');
  });

  it('returns empty for no hunks', () => {
    expect(buildSideRows([])).toEqual([]);
  });
});

describe('maxRowContentLength', () => {
  it('returns the longest content across both columns', () => {
    const rows = buildSideRows([hunk([
      ctx('short', 1, 1),
      add('a much longer modified line', 2),
    ])]);
    expect(maxRowContentLength(rows)).toBe('a much longer modified line'.length);
  });

  it('returns 0 for empty rows', () => {
    expect(maxRowContentLength([])).toBe(0);
  });
});
