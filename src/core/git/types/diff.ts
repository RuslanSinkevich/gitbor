export interface DiffLine {
  readonly type: 'add' | 'remove' | 'context';
  readonly content: string;
  readonly oldLineNo: number | null;
  readonly newLineNo: number | null;
}

export interface DiffHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffLine[];
}

export interface FileDiff {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  readonly hunks: readonly DiffHunk[];
  readonly isBinary: boolean;
}

export interface BlameLine {
  readonly hash: string;
  readonly author: string;
  readonly authorDate: number;
  readonly lineNo: number;
  readonly content: string;
  readonly summary: string;
}

export interface BlameResult {
  readonly path: string;
  readonly lines: readonly BlameLine[];
}

export interface FileHistoryEntry {
  readonly hash: string;
  readonly shortHash: string;
  readonly subject: string;
  readonly authorName: string;
  readonly authorDate: number;
  readonly status: string;
}

export interface FileHistoryResult {
  readonly path: string;
  readonly entries: readonly FileHistoryEntry[];
}
