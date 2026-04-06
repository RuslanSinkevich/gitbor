export interface MergeResult {
  readonly success: boolean;
  readonly conflicts: readonly string[];
}

export interface OperationResult<T = void> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly rollbackAvailable: boolean;
}

export interface GitExecOptions {
  readonly cwd?: string;
  readonly timeout?: number;
  readonly maxBuffer?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
}

export interface GitExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly duration: number;
}

export interface MergeOptions {
  readonly noCommit: boolean;
  readonly squash: boolean;
  readonly ffOnly: boolean;
  readonly noFf?: boolean;
}

export interface ConflictFile {
  readonly path: string;
  readonly status: 'conflicted' | 'resolved' | 'staged';
  readonly oursModified: boolean;
  readonly theirsModified: boolean;
}

export interface MergeState {
  inProgress: boolean;
  sourceBranch: string;
  targetBranch: string;
  totalConflicts: number;
  resolvedConflicts: number;
  conflictFiles: ConflictFile[];
}
