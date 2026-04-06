export interface MergeOptions {
  noCommit: boolean;
  squash: boolean;
  ffOnly: boolean;
  noFf?: boolean;
}

export interface ConflictFile {
  path: string;
  status: 'conflicted' | 'resolved' | 'staged';
  oursModified: boolean;
  theirsModified: boolean;
}

export interface MergeState {
  inProgress: boolean;
  sourceBranch: string;
  targetBranch: string;
  totalConflicts: number;
  resolvedConflicts: number;
  conflictFiles: ConflictFile[];
}

export type ConflictResolution = 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first';

export interface ConflictBlock {
  type: 'clean' | 'conflict';
  content: string;
  ours: string;
  theirs: string;
}

export interface ConflictContent {
  file: string;
  blocks: ConflictBlock[];
  hasConflicts: boolean;
}
