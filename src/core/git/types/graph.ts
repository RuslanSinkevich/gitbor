import type { Commit } from './git';

export interface GraphNode {
  commitIndex: number;
  column: number;
  color: string;
  connections: GraphConnection[];
}

export interface GraphConnection {
  fromCol: number;
  toCol: number;
  color: string;
}

export interface MergeLink {
  childIdx: number;
  childCol: number;
  parentIdx: number;
  parentCol: number;
  color: string;
}

export interface GraphLayoutData {
  nodes: GraphNode[];
  maxColumns: number;
  mergeLinks: MergeLink[];
}

export interface CommitGraphData {
  commits: Commit[];
  layout: GraphLayoutData;
}
