import type { Commit } from './git';

export interface GraphNode {
  readonly commitIndex: number;
  readonly column: number;
  readonly color: string;
  readonly connections: readonly GraphConnection[];
}

export interface GraphConnection {
  readonly fromCol: number;
  readonly toCol: number;
  readonly color: string;
}

export interface MergeLink {
  readonly childIdx: number;
  readonly childCol: number;
  readonly parentIdx: number;
  readonly parentCol: number;
  readonly color: string;
}

export interface GraphLayoutData {
  readonly nodes: readonly GraphNode[];
  readonly maxColumns: number;
  readonly mergeLinks: readonly MergeLink[];
}

export interface CommitGraphData {
  readonly commits: readonly Commit[];
  readonly layout: GraphLayoutData;
}
