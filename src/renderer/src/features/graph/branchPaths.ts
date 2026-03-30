/**
 * Branch path grouping and SVG path generation.
 * Produces smooth curves similar to Fork/SourceTree.
 */
import type { GraphNode, MergeLink } from '../../types';
import { colX, rowY, ROW_HEIGHT } from './graphConstants';

export interface BranchPathData {
  color: string;
  d: string;
  lineWidth: number;
  minY: number;
  maxY: number;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Convert points into SVG path.
 * Consecutive same-column points → straight line.
 * Column transition → single cubic Bezier from start to end.
 */
function pointsToSvgPath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  let d = `M${points[0].x},${points[0].y}`;

  let i = 1;
  while (i < points.length) {
    const prev = points[i - 1];
    const cur = points[i];

    if (prev.x === cur.x) {
      // Vertical: coalesce consecutive same-x points into one L
      let endIdx = i;
      while (endIdx + 1 < points.length && points[endIdx + 1].x === prev.x) {
        endIdx++;
      }
      d += ` L${points[endIdx].x},${points[endIdx].y}`;
      i = endIdx + 1;
    } else {
      // Column transition: S-curve matching mhutchie/vscode-git-graph
      const dy = ROW_HEIGHT * 0.8;
      d += ` C${prev.x},${prev.y + dy} ${cur.x},${cur.y - dy} ${cur.x},${cur.y}`;
      i++;
    }
  }

  return d;
}

/**
 * Group per-row connections into continuous branch paths.
 * Each chain of connected same-color segments becomes one SVG <path>.
 */
export function groupBranchPaths(graphNodes: GraphNode[]): BranchPathData[] {
  interface Segment {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    color: string;
    fromCol: number;
    toCol: number;
    row: number;
  }

  const segments: Segment[] = [];

  for (const node of graphNodes) {
    const y = rowY(node.commitIndex);
    const nextY = rowY(node.commitIndex + 1);

    for (const conn of node.connections) {
      segments.push({
        fromX: colX(conn.fromCol),
        fromY: y,
        toX: colX(conn.toCol),
        toY: nextY,
        color: conn.color,
        fromCol: conn.fromCol,
        toCol: conn.toCol,
        row: node.commitIndex,
      });
    }
  }

  segments.sort((a, b) => a.row - b.row || a.fromCol - b.fromCol);

  const segIndex = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const key = `${seg.row}:${seg.fromCol}:${seg.color}`;
    const arr = segIndex.get(key);
    if (arr) arr.push(i);
    else segIndex.set(key, [i]);
  }

  const used = new Set<number>();
  const chains: { color: string; points: Point[] }[] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;

    const chain: Point[] = [];
    let idx = i;

    while (idx !== -1 && !used.has(idx)) {
      used.add(idx);
      const seg = segments[idx];

      if (chain.length === 0) {
        chain.push({ x: seg.fromX, y: seg.fromY });
      }

      // Only add point if it differs from last (avoid duplicate verticals)
      const last = chain[chain.length - 1];
      if (seg.toX !== last.x || seg.toY !== last.y) {
        chain.push({ x: seg.toX, y: seg.toY });
      }

      const nextKey = `${seg.row + 1}:${seg.toCol}:${seg.color}`;
      const candidates = segIndex.get(nextKey);
      idx = -1;
      if (candidates) {
        for (const c of candidates) {
          if (!used.has(c)) { idx = c; break; }
        }
      }
    }

    if (chain.length >= 2) {
      chains.push({ color: segments[i].color, points: chain });
    }
  }

  return chains.map(chain => {
    let minY = Infinity, maxY = -Infinity;
    for (const p of chain.points) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      color: chain.color,
      d: pointsToSvgPath(chain.points),
      lineWidth: 2,
      minY,
      maxY,
    };
  });
}

/**
 * Convert merge links into direct Bezier SVG paths.
 * Each merge link becomes one cubic curve from child to parent.
 */
export function getMergeLinkPaths(mergeLinks: MergeLink[]): BranchPathData[] {
  return mergeLinks.map(link => {
    const x1 = colX(link.childCol);
    const y1 = rowY(link.childIdx);
    const x2 = colX(link.parentCol);
    const y2 = rowY(link.parentIdx);

    let d: string;
    if (x1 === x2) {
      d = `M${x1},${y1} L${x2},${y2}`;
    } else {
      const dy = y2 - y1;
      d = `M${x1},${y1} C${x1},${y1 + dy * 0.4} ${x2},${y2 - dy * 0.4} ${x2},${y2}`;
    }

    return {
      color: link.color,
      d,
      lineWidth: 2,
      minY: Math.min(y1, y2),
      maxY: Math.max(y1, y2),
    };
  });
}

export interface NodeCircle {
  cx: number;
  cy: number;
  color: string;
  isMerge: boolean;
}

export function getNodeCircles(graphNodes: GraphNode[], commits: { parents: string[] }[]): NodeCircle[] {
  return graphNodes.map(node => ({
    cx: colX(node.column),
    cy: rowY(node.commitIndex),
    color: node.color,
    isMerge: commits[node.commitIndex]?.parents.length > 1,
  }));
}
