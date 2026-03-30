import type { Commit, Branch, Tag, Stash, Remote, FileStatus, RepoInfo } from './git';
import type { GraphLayoutData } from './graph';

export interface AppState {
  repoPath: string;
  repoName: string;
  currentBranch: string;
  branches: Branch[];
  tags: Tag[];
  stashes: Stash[];
  remotes: Remote[];
  stagedFiles: FileStatus[];
  unstagedFiles: FileStatus[];
  conflicts: string[];
  ahead: number;
  behind: number;
  commits: Commit[];
  graphLayout: GraphLayoutData;
  selectedCommitHash: string | null;
  isOperationRunning: boolean;
  currentOperation: string | null;
  openRepos: RepoInfo[];
  activeRepoIndex: number;
}

export interface RecoveryIssue {
  type: string;
  description: string;
  suggestedAction: { type: string; [key: string]: unknown };
}
