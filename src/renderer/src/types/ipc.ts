import type { AppState, RecoveryIssue } from './appState';
import type { CommitDetail } from './git';
import type { CommitGraphData } from './graph';
import type { FileDiff, BlameResult, FileHistoryResult } from './diff';
import type { RebaseTodoEntry, RebaseTodoList, RebaseProgress } from './rebase';
import type { Submodule } from './submodule';
import type { MergeOptions, MergeState, ConflictContent } from './merge';

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
  | { type: 'continueRebase' }
  | { type: 'abortRebase' }
  | { type: 'skipRebase' }
  | { type: 'checkout'; branch: string }
  | { type: 'fetch' }
  | { type: 'pull' }
  | { type: 'push' }
  | { type: 'stash'; message?: string }
  | { type: 'stashPop' }
  | { type: 'merge'; branch: string }
  | { type: 'createBranch'; name: string; from: string }
  | { type: 'renameBranch'; oldName: string; newName: string }
  | { type: 'deleteBranch'; branch: string; force?: boolean }
  | { type: 'createTag'; name: string; ref: string }
  | { type: 'deleteTag'; name: string; remote?: boolean }
  | { type: 'cherryPick'; hash: string }
  | { type: 'revert'; hash: string }
  | { type: 'resetTo'; hash: string; mode: 'soft' | 'mixed' | 'hard' }
  | { type: 'stashApply'; index: string }
  | { type: 'stashDrop'; index: string }
  | { type: 'commit'; message: string; amend?: boolean }
  | { type: 'stageFile'; file: string }
  | { type: 'unstageFile'; file: string }
  | { type: 'discardFileChanges'; file: string }
  | { type: 'startMerge'; source: string; options: MergeOptions }
  | { type: 'resolveWithOurs'; file: string }
  | { type: 'resolveWithTheirs'; file: string }
  | { type: 'completeMerge'; message?: string }
  | { type: 'abortMerge' }
  | { type: 'getConflictContent'; file: string }
  | { type: 'resolveConflict'; file: string; resolutions: ('ours' | 'theirs')[] }
  | { type: 'getMergeState' }
  | { type: 'predictConflicts'; source: string; target: string }
  | { type: 'openRepo'; path: string }
  | { type: 'openRepoDialog' }
  | { type: 'cloneRepo'; url: string; path: string }
  | { type: 'initRepo'; path: string }
  | { type: 'closeRepo'; index: number }
  | { type: 'switchRepo'; index: number }
  | { type: 'openDiff'; file: string; hash: string }
  | { type: 'openMergeEditor'; file: string }
  | { type: 'openFile'; file: string }
  | { type: 'switchView'; view: 'changes' | 'commits' };

export type MainEvent =
  | { type: 'fullState'; data: AppState }
  | { type: 'stateUpdate'; data: Partial<AppState> }
  | { type: 'commitDetails'; data: CommitDetail }
  | { type: 'graphData'; data: CommitGraphData }
  | { type: 'fileDiff'; data: FileDiff[]; file: string; hash: string }
  | { type: 'fileBlame'; data: BlameResult }
  | { type: 'fileHistory'; data: FileHistoryResult }
  | { type: 'submodules'; data: Submodule[] }
  | { type: 'rebaseTodo'; data: RebaseTodoList }
  | { type: 'rebaseProgress'; data: RebaseProgress }
  | { type: 'operationStart'; operation: string }
  | { type: 'operationEnd'; operation: string; success: boolean; error?: string }
  | { type: 'config'; lang: string }
  | { type: 'recoveryRequired'; issues: RecoveryIssue[] }
  | { type: 'mergeState'; data: MergeState }
  | { type: 'mergeCompleted' }
  | { type: 'mergeAborted' }
  | { type: 'conflictContent'; data: ConflictContent }
  | { type: 'predictedConflicts'; files: string[] }
  | { type: 'openDiff'; file: string; hash: string; repoPath: string }
  | { type: 'openMergeEditor'; file: string; repoPath: string }
  | { type: 'openFile'; file: string; repoPath: string }
  | { type: 'showView'; view: 'changes' | 'commits' }
  | { type: 'error'; message: string };
