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
} from '../git/types';
import type { ConflictContent } from '../git/ConflictParser';

// ─── Renderer → Main (commands via IPC) ───

export type RendererCommand =
  | { type: 'ready' }
  | { type: 'getState' }
  | { type: 'getCommitDetails'; hash: string }
  | { type: 'getGraphData'; maxCount: number }
  | { type: 'getFileDiff'; file: string; hash: string }
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
  | { type: 'pull'; rebase?: boolean }
  | { type: 'push'; force?: boolean; setUpstream?: boolean }
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
  | { type: 'resolveConflict'; file: string; resolutions: ('ours' | 'theirs')[] }
  | { type: 'getMergeState' }
  | { type: 'predictConflicts'; source: string; target: string }

  // Multi-repo
  | { type: 'openRepo'; path: string }
  | { type: 'openRepoDialog' }
  | { type: 'cloneRepo'; url: string; path: string }
  | { type: 'initRepo'; path: string }
  | { type: 'closeRepo'; index: number }
  | { type: 'switchRepo'; index: number }

  // Renderer-handled views
  | { type: 'openDiff'; file: string; hash: string }
  | { type: 'openMergeEditor'; file: string }
  | { type: 'openFile'; file: string }
  | { type: 'switchView'; view: 'changes' | 'commits' };

// ─── Main → Renderer (events via IPC) ───

export type MainEvent =
  | { type: 'fullState'; data: AppState }
  | { type: 'stateUpdate'; data: Partial<AppState> }
  | { type: 'commitDetails'; data: CommitDetail; hash: string }
  | { type: 'graphData'; data: CommitGraphData }
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
  | { type: 'openFile'; file: string; repoPath: string }
  | { type: 'showView'; view: 'changes' | 'commits' }
  | { type: 'stashDiff'; data: FileDiff[]; index: string }
  | { type: 'error'; message: string };
