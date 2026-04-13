export interface Commit {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: number;
  refs: RefInfo[];
  subject: string;
}

export interface RefInfo {
  name: string;
  type: 'branch' | 'remote' | 'tag' | 'head';
}

export interface Branch {
  name: string;
  hash: string;
  upstream?: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export interface Tag {
  name: string;
  hash: string;
}

export interface Stash {
  index: string;
  hash: string;
  message: string;
}

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface FileStatus {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'U' | '?';
  staged: boolean;
}

export interface FileChange {
  path: string;
  status: string;
  oldPath?: string;
}

export interface CommitDetail {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: number;
  committerName: string;
  committerEmail: string;
  commitDate: number;
  refs: RefInfo[];
  subject: string;
  body: string;
  files: FileChange[];
}

export interface RepoInfo {
  name: string;
  path: string;
}
