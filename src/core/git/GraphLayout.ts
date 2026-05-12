/**
 * Commit graph layout engine.
 *
 * Traces branch paths through the DAG, assigning each commit a column.
 * Merge connections reuse existing reserved columns to keep the graph compact.
 *
 * Algorithm based on public descriptions of path-tracing approaches
 * for git DAG visualization.
 */
import { Commit, GraphConnection, GraphLayoutData, GraphNode } from './types';

const PALETTE = [
  '#4EC9B0', '#569CD6', '#CE9178', '#C586C0',
  '#DCDCAA', '#9CDCFE', '#D7BA7D', '#F44747',
  '#B5CEA8', '#6796E6', '#608B4E', '#D16969',
  '#4FC1FF', '#C8C8C8', '#D4A0FF', '#89D185',
];

const SENTINEL_ID = -1;

interface Coord {
  readonly col: number;
  readonly row: number;
}

interface Segment {
  readonly start: Coord;
  readonly end: Coord;
  readonly anchorStart: boolean;
}

interface SlotReservation {
  readonly target: CommitNode | null;
  readonly lane: Lane;
}

class Lane {
  private readonly colorIdx: number;
  private _tail: number = 0;
  private _segments: Segment[] = [];

  constructor(colorIdx: number) {
    this.colorIdx = colorIdx;
  }

  appendSegment(start: Coord, end: Coord, anchorStart: boolean) {
    this._segments.push({ start, end, anchorStart });
  }

  getColorIdx() { return this.colorIdx; }
  getTail() { return this._tail; }
  setTail(v: number) { this._tail = v; }
  getSegments() { return this._segments; }
}

class CommitNode {
  readonly idx: number;

  private _col: number = 0;
  private _successors: CommitNode[] = [];
  private _predecessors: CommitNode[] = [];
  private _predCursor: number = 0;
  private _lane: Lane | null = null;
  private _freeCol: number = 0;
  private _slots: SlotReservation[] = [];

  constructor(idx: number) {
    this.idx = idx;
  }

  addSuccessor(n: CommitNode) { this._successors.push(n); }
  addPredecessor(n: CommitNode) { this._predecessors.push(n); }

  nextPredecessor(): CommitNode | null {
    return this._predCursor < this._predecessors.length
      ? this._predecessors[this._predCursor]
      : null;
  }

  advancePredecessor() { this._predCursor++; }

  hasMultiplePredecessors() { return this._predecessors.length > 1; }

  assignToLane(lane: Lane, col: number) {
    if (this._lane === null) {
      this._lane = lane;
      this._col = col;
    }
  }

  isUnassigned() { return this._lane === null; }

  getLane() { return this._lane; }

  position(): Coord { return { col: this._col, row: this.idx }; }
  nextFreePosition(): Coord { return { col: this._freeCol, row: this.idx }; }

  findReservedSlot(target: CommitNode | null, lane: Lane): Coord | null {
    for (let i = 0; i < this._slots.length; i++) {
      if (this._slots[i] &&
          this._slots[i].target === target &&
          this._slots[i].lane === lane) {
        return { col: i, row: this.idx };
      }
    }
    return null;
  }

  reserveSlot(col: number, target: CommitNode | null, lane: Lane) {
    if (col === this._freeCol) {
      this._freeCol = col + 1;
      this._slots[col] = { target, lane };
    }
  }

  getColorIdx() {
    return this._lane !== null ? this._lane.getColorIdx() : 0;
  }

  getCol() { return this._col; }
  getFreeCol() { return this._freeCol; }
}

export function computeGraphLayout(commits: Commit[]): GraphLayoutData {
  if (commits.length === 0) return { nodes: [], maxColumns: 0, mergeLinks: [] };

  const hashToIdx = new Map<string, number>();
  for (let i = 0; i < commits.length; i++) {
    hashToIdx.set(commits[i].hash, i);
  }

  const sentinel = new CommitNode(SENTINEL_ID);
  const graph: CommitNode[] = [];
  const lanes: Lane[] = [];
  const colorPool: number[] = [];

  for (let i = 0; i < commits.length; i++) {
    graph.push(new CommitNode(i));
  }

  for (let i = 0; i < commits.length; i++) {
    for (let j = 0; j < commits[i].parents.length; j++) {
      const pi = hashToIdx.get(commits[i].parents[j]);
      if (pi !== undefined) {
        graph[i].addPredecessor(graph[pi]);
        graph[pi].addSuccessor(graph[i]);
      } else {
        graph[i].addPredecessor(sentinel);
      }
    }
  }

  function pickColor(from: number): number {
    for (let i = 0; i < colorPool.length; i++) {
      if (from > colorPool[i]) return i;
    }
    colorPool.push(0);
    return colorPool.length - 1;
  }

  function tracePath(origin: number) {
    let i = origin;
    let node = graph[i];
    let pred = node.nextPredecessor();
    let cur: CommitNode;
    let prev = node.isUnassigned() ? node.nextFreePosition() : node.position();
    let next: Coord;

    if (
      pred !== null &&
      pred.idx !== SENTINEL_ID &&
      node.hasMultiplePredecessors() &&
      !node.isUnassigned() &&
      !pred.isUnassigned()
    ) {
      let reached = false;
      const predLane = pred.getLane()!;
      for (i = origin + 1; i < graph.length; i++) {
        cur = graph[i];
        next = cur.findReservedSlot(pred, predLane)!;
        if (next !== null) {
          reached = true;
        } else {
          next = cur.nextFreePosition();
        }
        predLane.appendSegment(
          prev, next,
          !reached && cur !== pred ? prev.col < next.col : true
        );
        cur.reserveSlot(next.col, pred, predLane);
        prev = next;

        if (reached) {
          node.advancePredecessor();
          break;
        }
      }
    } else {
      const lane = new Lane(pickColor(origin));
      node.assignToLane(lane, prev.col);
      node.reserveSlot(prev.col, node, lane);

      for (i = origin + 1; i < graph.length; i++) {
        cur = graph[i];
        next = (pred === cur && !pred!.isUnassigned())
          ? cur.position()
          : cur.nextFreePosition();
        lane.appendSegment(prev, next, prev.col < next.col);
        cur.reserveSlot(next.col, pred, lane);
        prev = next;

        if (pred === cur) {
          node.advancePredecessor();
          const alreadyAssigned = !pred!.isUnassigned();
          pred!.assignToLane(lane, next.col);
          node = pred!;
          pred = node.nextPredecessor();
          if (pred === null || alreadyAssigned) {
            break;
          }
        }
      }

      if (i === graph.length && pred !== null && pred.idx === SENTINEL_ID) {
        node.advancePredecessor();
      }

      lane.setTail(i);
      lanes.push(lane);
      colorPool[lane.getColorIdx()] = i;
    }
  }

  let cursor = 0;
  let safetyCounter = 0;
  const maxIterations = graph.length * (graph.length + 1);
  while (cursor < graph.length) {
    if (++safetyCounter > maxIterations) break;
    if (graph[cursor].nextPredecessor() !== null || graph[cursor].isUnassigned()) {
      const predBefore = graph[cursor].nextPredecessor();
      const wasUnassigned = graph[cursor].isUnassigned();
      tracePath(cursor);
      if (graph[cursor].nextPredecessor() === predBefore && graph[cursor].isUnassigned() === wasUnassigned) {
        graph[cursor].advancePredecessor();
      }
    } else {
      cursor++;
    }
  }

  // --- Convert to GraphNode / GraphConnection ---

  const rowConns: GraphConnection[][] = [];
  for (let i = 0; i < commits.length; i++) rowConns.push([]);

  for (const lane of lanes) {
    const color = PALETTE[lane.getColorIdx() % PALETTE.length];
    for (const seg of lane.getSegments()) {
      if (seg.start.row < 0 || seg.start.row >= commits.length) continue;

      if (seg.end.row === seg.start.row + 1) {
        rowConns[seg.start.row].push({ fromCol: seg.start.col, toCol: seg.end.col, color });
      } else {
        rowConns[seg.start.row].push({ fromCol: seg.start.col, toCol: seg.end.col, color });
        for (let r = seg.start.row + 1; r < Math.min(seg.end.row, commits.length); r++) {
          rowConns[r].push({ fromCol: seg.end.col, toCol: seg.end.col, color });
        }
      }
    }
  }

  let maxCols = 0;
  const nodes: GraphNode[] = [];
  for (let i = 0; i < commits.length; i++) {
    const n = graph[i];
    const col = !n.isUnassigned() ? n.getCol() : 0;
    const color = !n.isUnassigned()
      ? PALETTE[n.getColorIdx() % PALETTE.length]
      : PALETTE[0];
    const fc = n.getFreeCol();
    if (fc > maxCols) maxCols = fc;

    nodes.push({
      commitIndex: i,
      column: col,
      color,
      connections: rowConns[i],
      isRemoteOnly: commits[i].isRemoteOnly === true,
    });
  }

  return { nodes, maxColumns: maxCols, mergeLinks: [] };
}
