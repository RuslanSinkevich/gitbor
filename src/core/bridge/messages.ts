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
  RecoveryAction,
  RecoveryIssue,
  ReflogEntry,
  GitErrorClass,
  SavedOperationState,
  SuggestedAction,
  PreflightIssue,
} from '../git/types';
import type { ConflictContent } from '../git/types';
import type { GitActivityEntry } from '../activity/GitActivityStore';
import type { AiProviderConfig } from '../ai/types';
export type { GitActivityEntry, GitActivityCommand } from '../activity/GitActivityStore';
export type { AiConnectionMode, AiProviderConfig, CommitLanguage } from '../ai/types';

// ─── Renderer → Main (commands via IPC) ───

import type { ErrorSeverity, OperationSource } from '../errors/severity';
export type { ErrorSeverity, OperationSource } from '../errors/severity';

type RendererCommandCore =
  | { type: 'ready' }
  | { type: 'getState' }
  | { type: 'refreshAll' }
  | { type: 'refreshStatIndex' }
  | { type: 'restoreStatDirty'; file: string }
  | { type: 'getCommitDetails'; hash: string }
  | { type: 'getGraphData'; maxCount: number }
  | { type: 'getFileDiff'; file: string; hash: string; ignoreWhitespace?: boolean; fullContext?: boolean }
  | { type: 'getFileBlame'; file: string; hash?: string }
  | { type: 'getFileHistory'; file: string }
  | { type: 'addRemote'; name: string; url: string }
  | { type: 'removeRemote'; name: string }
  | { type: 'renameRemote'; oldName: string; newName: string }
  | { type: 'stageHunk'; file: string; hunkIndex: number; reverse?: boolean }
  | { type: 'stageLines'; file: string; hunkIndex: number; lineIndices: number[]; reverse?: boolean }
  | { type: 'discardHunk'; file: string; hunkIndex: number }
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
  | { type: 'checkout'; branch: string; mode?: 'keep' | 'stash' | 'discard' }
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
  | { type: 'cherryPick'; hash: string; mainline?: number }
  | { type: 'revert'; hash: string; mainline?: number }
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
  | { type: 'discardFiles'; files: string[] }
  | { type: 'deleteUntrackedFiles'; files: string[] }

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
  /* Native folder picker — возвращает путь (через invoke) или null.
     Отличается от openRepoDialog тем, что НЕ открывает выбранную папку
     как репо. Нужен для clone/init dialogs (Обзор...). */
  | { type: 'pickDirectory'; title?: string; defaultPath?: string }

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

  // Repo summary (lightweight info for any path, used in RepoManager list)
  | { type: 'getRepoSummary'; path: string }

  // AI
  | { type: 'aiGetConfig' }
  | { type: 'aiSetConfig'; config: AiProviderConfig | null }
  | { type: 'aiTestConnection'; config: AiProviderConfig }
  | { type: 'aiTestPrompt'; config: AiProviderConfig }
  | { type: 'aiGetLastDebug' }
  | { type: 'aiGenerateCommitMessage'; requestId: string }
  | { type: 'aiCancelGenerate'; requestId: string }

  // AI Tier-2 features (см. docs/tasks/ai-tier2-features-todo.md).
  // Все streaming-вызовы (explain/reflog/conflict) идут через aiChunk/aiDone/
  // aiError с собственным requestId и отменяются через aiCancelGenerate.
  | { type: 'aiExplainCommit'; requestId: string; hash: string }
  | { type: 'aiExplainReflog'; requestId: string; maxCount?: number }
  | { type: 'aiAnalyzeConflict'; requestId: string; file: string }
  // Synchronous Tier-2 calls — короткий ответ возвращается одним IPC.
  | { type: 'aiSuggestStashName' }
  | { type: 'aiSemanticSearch'; query: string; maxCommits?: number }

  // Safety: явный выбор юзера в SafetyDialog
  | { type: 'safetyResolve'; requestId: string; action: RecoveryAction }
  | { type: 'killGitProcess'; pid: number }
  | { type: 'removeIndexLock' }
  | { type: 'rollbackOperation'; journalEntryId: string }
  | { type: 'checkForUpdates' }
  | { type: 'appUpdateInstall' };

/** Источник операции (user/background). Не путать с `source` в merge-командах (имя ветки). */
export type RendererCommand = RendererCommandCore & { opSource?: OperationSource };

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
  /**
   * Начало long-running операции. `repoPath` — на каком репо она запущена.
   * Renderer держит `runningOpsByRepo` per-repo карту; флаг
   * `isOperationRunning` для UI вычисляется от активной вкладки. Без
   * `repoPath` fetch на репо A блокировал бы кнопки на репо B.
   */
  | { type: 'operationStart'; operation: string; repoPath?: string | null }
  | {
      type: 'operationEnd';
      operation: string;
      success: boolean;
      error?: string;
      repoPath?: string | null;
      errorClass?: GitErrorClass;
      savedState?: SavedOperationState;
      suggestedActions?: SuggestedAction[];
      preflightIssues?: PreflightIssue[];
      journalEntryId?: string;
      severity?: ErrorSeverity;
      source?: OperationSource;
      hookOutput?: string;
    }
  /**
   * Pre-flight блок: pre-flight нашёл блокер ДО старта операции (lock/UU/...).
   * Renderer открывает SafetyDialog и ждёт ответ через `safetyResolve`.
   * `requestId` склеивает request с ответом.
   */
  | {
      type: 'safetyIssue';
      requestId: string;
      operation: string;
      repoPath?: string | null;
      issues: PreflightIssue[];
      suggestedActions: SuggestedAction[];
    }
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
  | { type: 'gitignoreContent'; data: string; exists: boolean }
  | { type: 'repoStats'; data: RepoStats }
  | { type: 'dayCommits'; data: DayCommitEntry[] }
  | { type: 'authorCodeStats'; data: AuthorCodeStatsResult }
  | { type: 'gitActivitySnapshot'; data: GitActivityEntry[] }
  | { type: 'gitActivityAdded'; entry: GitActivityEntry }
  | { type: 'gitActivityUpdated'; entry: GitActivityEntry }
  | { type: 'gitActivityCleared' }
  | { type: 'repoClosed'; path: string }
  | { type: 'appUpdateReady'; version: string }
  | {
      type: 'appUpdateManualResult';
      result: 'nsis-only' | 'available' | 'up-to-date' | 'error';
      version?: string;
      current?: string;
      error?: string;
    }
  /**
   * Сменилась видимость окна. Renderer использует это, чтобы остановить
   * фоновую активность (авто-fetch, опросные таймеры) пока окно скрыто
   * или свёрнуто: за многочасовые свёрнутые сессии в монорепо
   * накапливался measurable backlog в renderer-heap.
   * Шлётся main'ом по событиям `minimize`/`restore`/`hide`/`show`.
   */
  | { type: 'windowVisibility'; visible: boolean }


  // AI events
  | { type: 'aiConfig'; config: AiProviderConfig | null }
  | { type: 'aiTestResult'; success: boolean; error?: string }
  | { type: 'aiTestPromptResult'; success: boolean; error?: string; snapshot: import('../ai/types').AiDebugSnapshot | null }
  | { type: 'aiLastDebug'; snapshot: import('../ai/types').AiDebugSnapshot | null }
  | { type: 'aiChunk'; requestId: string; delta: string }
  | { type: 'aiDone'; requestId: string; text: string; finishReason: string }
  | { type: 'aiError'; requestId: string; message: string; kind: string }
  // Sync Tier-2 responses (короткий one-shot ответ).
  | { type: 'aiStashNameResult'; success: boolean; name?: string; error?: string }
  | { type: 'aiSemanticSearchResult'; success: boolean; hashes?: string[]; error?: string }

  /**
   * Универсальная ошибка от main → renderer.
   * - `message`: уже-готовый текст (фолбэк, если код не распознан).
   * - `code`:    стабильный идентификатор для локализации в renderer
   *              (см. locale.repoErrors.*). Если задан — renderer берёт
   *              из своей локали и интерполирует `data` через `tpl()`.
   * - `data`:    параметры для шаблона (например `{ path: '/foo' }`).
   */
  | { type: 'error'; message: string; code?: string; data?: Record<string, string> };

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

// ─── Repo summary (lightweight) ───
export interface RepoSummaryBranchDto {
  name: string;
  hash: string;
  isCurrent: boolean;
}

export interface RepoSummaryTagDto {
  name: string;
  hash: string;
}

export interface RepoSummaryCommitDto {
  hash: string;
  subject: string;
  authorName: string;
  authorDate: number;
}

export interface RepoSummaryDto {
  valid: boolean;
  branches: RepoSummaryBranchDto[];
  tags: RepoSummaryTagDto[];
  remotes: string[];
  uncommitted: number;
  recentCommits: RepoSummaryCommitDto[];
  lastCommitMessage: string;
  lastCommitAuthor: string;
  lastCommitDate: number;
}
