import {
  AppState,
  CommitDetail,
  CommitGraphData,
  FileDiff,
  BlameResult,
  FileHistoryResult,
  RebaseTodoEntry,
  RebaseTodoList,
  RebaseProgress,
  Submodule,
  MergeOptions,
  MergeState,
  RecoveryIssue,
  ReflogEntry,
} from '../git/types';
import type { ConflictContent } from '../git/types';
import type { GitActivityEntry } from '../activity/GitActivityStore';
import type { AiProviderConfig } from '../ai/types';
export type { GitActivityEntry, GitActivityCommand, GitActivityStatus } from '../activity/GitActivityStore';
export type { AiProviderConfig, CommitLanguage } from '../ai/types';

// ─── Renderer → Main (commands via IPC) ───

export type RendererCommand =
  | { type: 'ready' }
  | { type: 'getState' }
  | { type: 'refreshAll' }
  | { type: 'getCommitDetails'; hash: string }
  | { type: 'getGraphData'; maxCount: number }
  | { type: 'getFileDiff'; file: string; hash: string; ignoreWhitespace?: boolean }
  | { type: 'getFileBlame'; file: string; hash?: string }
  | { type: 'getFileHistory'; file: string }
  | { type: 'addRemote'; name: string; url: string }
  | { type: 'removeRemote'; name: string }
  | { type: 'renameRemote'; oldName: string; newName: string }
  | { type: 'stageHunk'; file: string; hunkIndex: number; reverse?: boolean }
  | { type: 'stageLines'; file: string; hunkIndex: number; lineIndices: number[]; reverse?: boolean }
  | { type: 'getSubmodules' }
  | { type: 'submoduleUpdate'; path: string }
  | { type: 'submoduleInit'; path: string }
  | { type: 'getRebaseTodo'; onto: string }
  | { type: 'executeRebase'; onto: string; entries: RebaseTodoEntry[] }
  | { type: 'rebaseTo'; onto: string }
  | { type: 'continueRebase' }
  | { type: 'abortRebase' }
  | { type: 'skipRebase' }

  // Git operations
  | { type: 'checkout'; branch: string }
  | { type: 'fetch'; remote?: string }
  | { type: 'pull'; rebase?: boolean; autostash?: boolean }
  | { type: 'pullFrom'; remote: string; branch: string; rebase?: boolean; autostash?: boolean }
  | { type: 'push'; force?: boolean; setUpstream?: boolean }
  | { type: 'pushTo'; remote: string; branch: string; force?: boolean; setUpstream?: boolean }
  | { type: 'stash'; message?: string }
  | { type: 'stashPop' }
  | { type: 'merge'; branch: string }

  // Branch operations
  | { type: 'createBranch'; name: string; from: string }
  | { type: 'renameBranch'; oldName: string; newName: string }
  | { type: 'deleteBranch'; branch: string; force?: boolean }

  // Tag operations
  | { type: 'createTag'; name: string; ref: string; message?: string }
  | { type: 'deleteTag'; name: string; remote?: boolean }

  // Patch
  | { type: 'saveAsPatch'; hash: string }

  // Commit operations
  | { type: 'cherryPick'; hash: string }
  | { type: 'revert'; hash: string }
  | { type: 'resetTo'; hash: string; mode: 'soft' | 'mixed' | 'hard' }

  // Stash operations
  | { type: 'stashShow'; index: string }
  | { type: 'stashApply'; index: string }
  | { type: 'stashPopIndex'; index: string }
  | { type: 'stashDrop'; index: string }

  // Commit
  | { type: 'commit'; message: string; amend?: boolean }

  // File operations
  | { type: 'stageFile'; file: string }
  | { type: 'stageAll'; files: string[] }
  | { type: 'unstageFile'; file: string }
  | { type: 'unstageAll'; files: string[] }
  | { type: 'discardFileChanges'; file: string }
  | { type: 'deleteUntrackedFile'; file: string }

  // Merge conflict operations
  | { type: 'startMerge'; source: string; options: MergeOptions }
  | { type: 'resolveWithOurs'; file: string }
  | { type: 'resolveWithTheirs'; file: string }
  | { type: 'completeMerge'; message?: string }
  | { type: 'abortMerge' }
  | { type: 'getConflictContent'; file: string }
  | { type: 'resolveConflictRaw'; file: string; content: string }
  | { type: 'getMergeState' }
  | { type: 'predictConflicts'; source: string; target: string }

  // Multi-repo
  | { type: 'openRepo'; path: string }
  | { type: 'openRepoDialog' }
  | { type: 'cloneRepo'; url: string; path: string }
  | { type: 'initRepo'; path: string }
  | { type: 'closeRepo'; index: number }
  | { type: 'switchRepo'; index: number }

  // Shell actions
  | { type: 'openInExplorer' }
  | { type: 'openInTerminal' }

  // Repo settings
  | { type: 'getRepoSettings' }
  | { type: 'setRepoSettings'; useGlobal: boolean; name: string; email: string }

  // SSH keys
  | { type: 'listSshKeys' }
  | { type: 'generateSshKey'; name: string; keyType: 'ed25519' | 'rsa'; passphrase: string; comment: string }
  | { type: 'deleteSshKey'; name: string }
  | { type: 'getPublicKey'; name: string }

  // LFS
  | { type: 'getLfsStatus' }
  | { type: 'lfsTrack'; pattern: string }
  | { type: 'lfsUntrack'; pattern: string }

  // Worktrees
  | { type: 'getWorktrees' }
  | { type: 'addWorktree'; path: string; branch: string; createBranch: boolean }
  | { type: 'removeWorktree'; path: string; force: boolean }

  // Git Hooks
  | { type: 'getHooks' }
  | { type: 'toggleHook'; name: string; enable: boolean }

  // Reflog
  | { type: 'getReflog'; maxCount?: number }
  | { type: 'restoreReflog'; hash: string }

  // Bisect
  | { type: 'bisectStart'; bad: string; good: string }
  | { type: 'bisectGood' }
  | { type: 'bisectBad' }
  | { type: 'bisectSkip' }
  | { type: 'bisectReset' }
  | { type: 'getBisectStatus' }

  // Gitignore
  | { type: 'getGitignore' }
  | { type: 'writeGitignore'; content: string }

  // Repository Statistics
  | { type: 'getRepoStats' }
  | { type: 'getDayCommits'; author: string; date: string }
  | { type: 'getAuthorCodeStats'; authorName: string; authorEmail: string; cacheOnly?: boolean; force?: boolean }

  // Git Activity Log
  | { type: 'getGitActivity' }
  | { type: 'clearGitActivity' }

  // Compare two commits
  | { type: 'getCommitDiff'; fromHash: string; toHash: string }

  // Renderer-handled views
  | { type: 'openDiff'; file: string; hash: string }
  | { type: 'openMergeEditor'; file: string }
  | { type: 'openFile'; file: string }
  | { type: 'switchView'; view: 'changes' | 'commits' }

  // AI
  | { type: 'aiGetConfig' }
  | { type: 'aiSetConfig'; config: AiProviderConfig | null }
  | { type: 'aiTestConnection'; config: AiProviderConfig }
  | { type: 'aiGenerateCommitMessage'; requestId: string }
  | { type: 'aiCancelGenerate'; requestId: string };

// ─── Main → Renderer (events via IPC) ───

export type MainEvent =
  | { type: 'fullState'; data: AppState }
  | { type: 'stateUpdate'; data: Partial<AppState> }
  | { type: 'commitDetails'; data: CommitDetail; hash: string }
  | { type: 'graphData'; data: CommitGraphData; repoPath: string }
  | { type: 'fileDiff'; data: FileDiff[]; file: string; hash: string }
  | { type: 'fileBlame'; data: BlameResult; file: string }
  | { type: 'fileHistory'; data: FileHistoryResult; file: string }
  | { type: 'submodules'; data: Submodule[] }
  | { type: 'rebaseTodo'; data: RebaseTodoList }
  | { type: 'rebaseProgress'; data: RebaseProgress }
  | { type: 'operationStart'; operation: string }
  | { type: 'operationEnd'; operation: string; success: boolean; error?: string }
  | { type: 'config'; lang: string }
  | { type: 'recoveryRequired'; issues: readonly RecoveryIssue[] }
  | { type: 'mergeState'; data: MergeState }
  | { type: 'mergeCompleted' }
  | { type: 'mergeAborted' }
  | { type: 'conflictContent'; data: ConflictContent }
  | { type: 'predictedConflicts'; files: string[] }
  | { type: 'openDiff'; file: string; hash: string; repoPath: string }
  | { type: 'openMergeEditor'; file: string; repoPath: string }
  | { type: 'showView'; view: 'changes' | 'commits' }
  | { type: 'stashDiff'; data: FileDiff[]; index: string }
  | { type: 'repoSettings'; data: import('../git/GitConfig').RepoSettings }
  | { type: 'sshKeys'; data: import('../ssh/SshKeyManager').SshKeyInfo[] }
  | { type: 'publicKey'; name: string; content: string }
  | { type: 'lfsStatus'; data: import('../git/LfsManager').LfsStatus }
  | { type: 'worktrees'; data: import('../git/WorktreeManager').WorktreeInfo[] }
  | { type: 'hooks'; data: import('../git/HooksManager').HookInfo[] }
  | { type: 'reflog'; data: ReflogEntry[] }
  | { type: 'bisectStatus'; data: import('../git/BisectManager').BisectStatus }
  | { type: 'bisectOutput'; output: string }
  | { type: 'commitDiff'; data: { fromHash: string; toHash: string; files: import('../git/types').FileChange[] } }
  | { type: 'gitignoreContent'; data: string }
  | { type: 'repoStats'; data: RepoStats }
  | { type: 'dayCommits'; data: DayCommitEntry[] }
  | { type: 'authorCodeStats'; data: AuthorCodeStatsResult }
  | { type: 'gitActivitySnapshot'; data: GitActivityEntry[] }
  | { type: 'gitActivityAdded'; entry: GitActivityEntry }
  | { type: 'gitActivityUpdated'; entry: GitActivityEntry }
  | { type: 'gitActivityCleared' }
  | { type: 'repoClosed'; path: string }

  // AI events
  | { type: 'aiConfig'; config: AiProviderConfig | null }
  | { type: 'aiTestResult'; success: boolean; error?: string }
  | { type: 'aiChunk'; requestId: string; delta: string }
  | { type: 'aiDone'; requestId: string; text: string; finishReason: string }
  | { type: 'aiError'; requestId: string; message: string; kind: string }

  | { type: 'error'; message: string };

export interface DayCommitEntry {
  hash: string;
  subject: string;
  date: string;
}

// ─── Repository Statistics types ───

export interface MonthlyCount {
  month: string;
  count: number;
}

export interface AuthorStats {
  name: string;
  email: string;
  commits: number;
  percentage: number;
  firstDate: string;
  lastDate: string;
  dailyCounts: Record<string, number>;
  monthlyCounts: MonthlyCount[];
  mostActiveDay: string;
  avgPerWeek: number;
}

export interface RepoStats {
  totalCommits: number;
  period: { from: string; to: string };
  monthlyCounts: MonthlyCount[];
  authors: AuthorStats[];
}

export interface AuthorCodeStats {
  authorName: string;
  authorEmail: string;
  headHash: string;
  addedLines: number;
  deletedLines: number;
  netLines: number;
  touchedFiles: number;
  binaryFiles: number;
  calculatedAt: number;
}

export interface AuthorCodeStatsResult {
  authorName: string;
  authorEmail: string;
  stats: AuthorCodeStats | null;
  fromCache: boolean;
}
