export interface Commit {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: number;
  readonly refs: readonly RefInfo[];
  readonly subject: string;
}

export interface RefInfo {
  readonly name: string;
  readonly type: 'branch' | 'remote' | 'tag' | 'head';
}

export interface Branch {
  readonly name: string;
  readonly hash: string;
  readonly upstream?: string;
  readonly isCurrent: boolean;
  readonly isRemote: boolean;
}

export interface Tag {
  readonly name: string;
  readonly hash: string;
}

export interface Stash {
  readonly index: string;
  readonly hash: string;
  readonly message: string;
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl: string;
  readonly pushUrl: string;
}

export interface FileStatus {
  readonly path: string;
  readonly status: 'M' | 'A' | 'D' | 'R' | 'U' | '?';
  readonly staged: boolean;
}

export interface FileChange {
  readonly path: string;
  readonly status: string;
}

export interface CommitDetail {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: number;
  readonly committerName: string;
  readonly committerEmail: string;
  readonly commitDate: number;
  readonly refs: readonly RefInfo[];
  readonly subject: string;
  readonly body: string;
  readonly files: readonly FileChange[];
}

export interface RepoInfo {
  readonly name: string;
  readonly path: string;
}
