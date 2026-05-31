export interface Commit {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: number;
  refs: RefInfo[];
  subject: string;
  /** GPG signature status: G=good, B=bad, U=untrusted, N=none, etc. */
  gpgStatus?: string;
  /**
   * Commit reachable only from refs/remotes (fetched but not merged into
   * any local branch yet). Filled by RepoStateRefresher after parse;
   * GitParser leaves it as false.
   */
  isRemoteOnly: boolean;
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
  /**
   * Hash базового коммита, на котором сделан stash (первый родитель
   * stash-коммита). Нужен, чтобы нарисовать stash мини-веткой в графе,
   * прицепив его к нужному ряду. Может отсутствовать на старых данных.
   */
  parentHash?: string;
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
  /**
   * Файл попал в status как `M` из-за stat-dirty (mtime изменилась,
   * содержимое — нет). Backend выставляет когда успевает проверить
   * `git diff --numstat` (≤20 M-файлов в статусе). UI рендерит
   * такие строки тусклыми с подсказкой.
   */
  statDirty?: boolean;
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

/** Single entry from `git reflog`. */
export interface ReflogEntry {
  hash: string;
  shortHash: string;
  action: string;
  message: string;
  date: string;
  index: number;
}
