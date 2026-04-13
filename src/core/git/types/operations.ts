export interface MergeResult {
  success: boolean;
  conflicts: string[];
}

export interface OperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  rollbackAvailable: boolean;
}

export interface GitExecOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string>;
  stdin?: string;
}

export interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

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
