> Русская версия: [docs/ru/architecture.md](ru/architecture.md)

## Overview

SkyFork is a 4-layer Electron application. Dependencies flow downward only.

## Layers

```
Renderer (React) → Preload (contextBridge) → Main (Node.js) → Git binary
```

- **Renderer** — React 18, Vite, CSS Modules. Feature folders: graph, sidebar, changes, diff, merge, blame, file-history, rebase, repo-manager, repo-tabs, toolbar, titlebar, layout, ssh, settings. State is driven by hooks: `useAppState`, `useMenuActions`, `useKeyboardShortcuts`, `useOperationToasts`, `useDiffState`, `useTheme`, `useToasts`, `useContextMenu`.

- **Preload** — `contextBridge.exposeInMainWorld('skyForkAPI', …)` exposes `invoke`, `onEvent`, and `platform` to the isolated renderer.

- **Main process** — Services are initialized in `main.ts`: `RepoServicesRegistry` (per-repo `GitExecutor` / `OperationQueue` / `SafetyNet`), `StateManager`, `CommandHandler`, `MessageBridge` (with handlers split into `bridge/ipc/`), `FileWatcher`, `WorkerPool` for parser offload. IPC is routed through `MessageBridge`. No native menu — `Menu.setApplicationMenu(null)`. All menus and keyboard shortcuts live in the renderer.

- **Git** — Invoked as a child process via `execFile('git', args)`. `GitExecutor` handles execution, timeout, env passing, and logging. `cwd` is fixed at construction — each repo gets its own `GitExecutor` so switching the active repo never drags one executor between paths.

## Data Flow

```
User clicks button in React
  → postCommand({ type: 'stageFile', file: 'src/app.ts' })
  → api.ts → window.skyForkAPI.invoke(command)
  → preload/index.ts → ipcRenderer.invoke('skyfork:command', command)
  → MessageBridge.handleCommand(command)
  → CommandHandler.stageFile('src/app.ts')
  → writeCommands.stageFile() → git.exec(['add', '--', 'src/app.ts'])
  → StateManager.refreshStatusAndNotify()
  → MessageBridge.send({ type: 'stateUpdate', data: newState })
  → preload → ipcRenderer.on('skyfork:event')
  → api.ts eventListeners → useAppState setState
  → React re-renders with new stagedFiles
```

## Core Modules

Modules under `src/core/`:

| Module | Role |
|--------|------|
| **GitExecutor** | Runs Git via `execFile`, ~30s timeout, env support, logs to file. Sensitive args (messages, passphrases) redacted via `sanitizeArgs`. `cwd` is set in constructor — each repo gets its own executor; switching repos happens at the `RepoServicesRegistry` level, not via `setCwd`. `killAll()` SIGTERMs only this repo's inflight processes. |
| **RepoServicesRegistry** | Per-repo services registry: `Map<repoPath, { git, queue, safety }>` plus a bootstrap set for clone/init when no repo is open. `acquire(repoPath)` lazily creates services, `release(repoPath)` kills inflight processes. This breaks global serialization: a long `git pull` on repo A no longer blocks operations on repo B. |
| **GitParser** | Pure parsers: `parseCommits`, `parseBranches`, `parseTags`, `parseStatus`, `parseFileChanges`. Big stdouts (status > 256 KB, log > 512 KB) are offloaded to `WorkerPool`. |
| **GraphLayout** | Lane assignment for commit graph layout. Computed inside a worker thread when `commits.length > 2000`. |
| **WorkerPool** | `worker_threads` pool (2 workers, round-robin) for CPU-heavy tasks: `parseStatus`, `parseCommits`, `computeGraphLayout`. Small inputs run inline (size threshold). On `error` / non-zero `exit` the slot is removed and a fresh worker is spawned via `setImmediate` — a dead worker never lingers in the pool. |
| **DiffParser** | Turns unified diff text into `FileDiff` / `DiffHunk` / `DiffLine`. |
| **ConflictParser** | Parses conflict markers for the merge editor. |
| **GitConfig** | Reads/writes `user.name`, `user.email` (local/global scope). |
| **StateManager** | Per-repo source of truth: `slicesByRepo: Map<repoPath, RepoSlice>` + a shared `meta` (`openRepos`, `activeRepoIndex`). All `refresh*` methods accept `repoPath` and update a specific slice; before any work the manager checks `isRepoTracked(repoPath)` so a background refresh can never resurrect a just-closed repo. `switchRepo` mirrors the cached slice and `notify`s immediately; the heavy refresh runs in the background. |
| **repoSlice** | The `RepoSlice` interface + `emptyRepoSlice` / `mirrorRepoSliceToAppState` / git-format constants (`GIT_LOG_FORMAT`, `GIT_REF_FORMAT`, `GIT_TAG_REF_FORMAT`, `GIT_STASH_FORMAT`) + `hashGitStdout` for `git log` deduplication. Extracted from `StateManager` to keep it focused. |
| **CommandHandler** | Orchestrates Git work; delegates to `readCommands` / `writeCommands`. All executors (`git`/`queue`/`safety` plus `RebaseManager`/`ConflictManager`/...) are looked up per-call via `state.getActiveServices()` — no mutable class fields tied to a single repo. `openRepo` throws `AppError('repoErrors.notARepo', { path })` with a localization code when the path is not a Git repo. |
| **MessageBridge** | Electron IPC: a thin ~150-line wrapper. Accepts `RendererCommand`, looks up the handler in `ipcCommandHandlers` (aggregated from `bridge/ipc/handlersState.ts`, `handlersGitOps.ts`, `handlersRepoExtras.ts`, `handlersAi.ts`). Catches `AppError` and emits an `error`-event with `code`+`data` for renderer-side translation. Sends `graphData` with reference-based deduplication (`sentGraphByRepo`) — repeatedly toggling A→B→A doesn't push megabytes of JSON over IPC. |
| **bridge/ipc/** | IPC handler submodules: `helpers.ts` (`runTracked`/`op`/`opWithPostMerge`/`errOnFail`/`mergeStateAfter`), `ready.ts`, `handlersState.ts` (lifecycle, diff/blame/history), `handlersGitOps.ts` (push/pull/fetch/commit/stage/merge/rebase), `handlersRepoExtras.ts` (LFS, worktrees, hooks, stats, bisect, repo-tabs, settings, SSH), `handlersAi.ts`. `op`/`opWithPostMerge` snapshot `repoPath` BEFORE starting and pass it into both `operationStart` and `operationEnd` so a tab switch between events doesn't break the per-repo running flag. |
| **OperationQueue** | Per-repo: read ops parallel, writes serialized. A separate queue per repo means blocking one repo cannot block another. |
| **SafetyNet** | Per-repo. Auto-stash before risky operations; rollback paths on failure. |
| **FileWatcher** | Per-repo `chokidar` watchers (`.git` + worktree, created lazily via `setImmediate` after a pre-scan). The worktree watcher is NOT started when `isDangerousRepoRoot(path)` is true (home, drive root, `C:\Windows`...) or when there are > 1000 top-level entries — otherwise an `EPERM`/`EACCES` cascade on `AppData`/`OneDrive` would crash main. Strict race-guard: if the repo is closed while async pre-scan is still running, no new watchers are created (or they are closed immediately). `chokidar.on('error')` swallows EPERM, depth=3, debounce: 50ms `.git`, 200ms worktree. |
| **repoPathGuard** | `isDangerousRepoRoot(path)` — checks whether a path is "dangerous" (drive root / home / Windows / `Program Files` / `node_modules` / etc.). Used by `FileWatcher` to skip the worktree watcher. Opening such folders is no longer hard-blocked — the user is allowed to look at any directory on purpose. |
| **AppError** | Structured error with a localization code (`code`) and template params (`data`) plus a technical fallback. `MessageBridge` turns it into an `error`-event with `code`/`data`; the renderer translates via `locale.repoErrors[code]` and interpolates `data`. Replaces "English-only strings that nobody translates". |
| **gitActivityStore** | Journal of git operations (start/append/finish) with `repoPath` per entry. `activityContext.ts` uses `AsyncLocalStorage` so `GitExecutor.exec` can attribute every command to its active operation without explicit id propagation. The renderer filters the journal by the active tab's `repoPath` — each repo sees only its own operations. |
| **Logger** | Levelled logging (`silent`/`error`/`warn`/`info`/`debug`) with stdout/stderr split and an optional `WriteStream` to `<userData>/logs/YYYY-MM-DD.log`. Singleton `mainLogger` is the single source of level for all modules. `configureMainLogger({ isProduction })` is called from `main.ts` after `app.whenReady`: prod → `silent` (silent in both console and file), dev → `debug`. ENV `SKYFORK_LOG_LEVEL` overrides the default — convenient for debugging on a packaged build at the user side. All ad-hoc `console.warn/error` in core (FileWatcher, WorkerPool, AiService, etc.) were migrated to `mainLogger`. Direct `console.error` remains only inside `process.on('unhandledRejection'/'uncaughtException')` — that is the last-resort handler that must run BEFORE `configureMainLogger`. |
| **SshKeyManager** | Lists, generates, deletes SSH keys in `~/.ssh/`. Two-step passphrase generation (no passphrase in argv). |
| **ReflogParser** | Parses `git reflog` output into structured entries. |
| **BisectManager** | Manages `git bisect` sessions: start, good, bad, skip, reset. |
| **HooksManager** | Lists, toggles (enable/disable), reads git hooks content. |
| **WorktreeManager** | Lists, adds, removes git worktrees. |
| **LfsManager** | Git LFS status, track/untrack patterns, list managed files. |
| **pathSecurity** | Path validation: `safePath` (traversal + symlink via `realpathSync.native` + Windows case-insensitive), `isSafeFilename`. |
| **AtomicWrite** | Atomic file writes via tmp+rename with fsync. Windows retry uses `Atomics.wait` (no busy-spin). |

## Renderer Modules

Feature folders under `src/renderer/src/features/`:

| Area | Contents |
|------|----------|
| **graph/** | `CommitGraph` (virtualized), `CommitDetails`, `branchPaths`. |
| **sidebar/** | Sidebar: branch tree, tags, stashes, remotes, submodules. |
| **changes/** | `LocalChanges` (tree), `CommitBar` (subject + description). |
| **diff/** | `DiffPanel`, `DiffView`, `DiffHunkView`, `DiffSideBySide`, `ImageDiff`. |
| **merge/** | `MergeDialog`, `MergeEditor`, `MergeBanner`, `ConflictPanel`. |
| — | **`AppDialogs.tsx`** — all modal dialogs extracted from `App.tsx` for cleaner separation of concerns. |
| **blame/** | `BlameView`. |
| **file-history/** | `FileHistory`. |
| **rebase/** | `RebaseEditor`. |
| **repo-manager/** | `RepoManager`, recent repositories. |
| **repo-tabs/** | Multi-repo tabs. |
| **toolbar/** | Fetch, Pull, Push, Stash actions. |
| **titlebar/** | `TitleBar` with custom `MenuBar` component. |
| **layout/** | `CommitsView`, `ChangesView`, `RightPanelContent`. |
| **ssh/** | `SshKeysDialog` — SSH key management UI. |
| **settings/** | `RepoSettingsDialog` — repository user.name/email settings. |
| **reflog/** | `ReflogDialog`, `ReflogTable`, `ReflogRow`, `ActionBadge`. |
| **bisect/** | `BisectDialog`, `BisectStartForm`, `BisectActiveSession`. |
| **hooks/** | `HooksDialog`, `HookItem`. |
| **worktrees/** | `WorktreesDialog`, `WorktreeItem`, `AddWorktreeForm`. |
| **lfs/** | `LfsDialog`, `LfsPatternList`, `LfsFileList`. |
| **gitignore/** | `GitignoreDialog`, templates. |

Custom hooks under `src/renderer/src/hooks/`:

| Hook | Role |
|------|------|
| **useAppState** | Global state from main process, IPC event handling. Language change triggers re-render via `configLang`. |
| **useMenuActions** | Unified handler for menu bar actions (dispatch by action string). |
| **useKeyboardShortcuts** | Maps keyboard shortcuts (Ctrl+O, Ctrl+Shift+F, F5, etc.) to menu actions. Skips in input/textarea/contentEditable. |
| **useOperationToasts** | Auto-shows toast notifications for git operation results. |
| **useDiffState** | Manages current diff target (file + hash). |
| **useTheme** | Dark/light theme toggle with localStorage persistence. |
| **useToasts** | Toast notification queue with auto-dismiss. |
| **useContextMenu** | Context menu state (position + items). |
| **useDialogs** | Centralized dialog visibility states (about, ssh, reflog, bisect, hooks, worktrees, lfs, gitignore). |

## IPC Protocol

`RendererCommand` defines 45+ command types; `MainEvent` defines 30+ event types. Canonical definitions live in `src/core/bridge/messages.ts`. The renderer imports types from `src/renderer/src/types/index.ts` which re-exports from `@core/git/types` and `@core/bridge/messages`.

## State Management

In main, `StateManager` keeps per-repo slices (`slicesByRepo`) plus shared `meta` (`openRepos`, `activeRepoIndex`). Each meaningful change of the active repo emits `stateUpdate` (without `commits`/`graphLayout` — those flow separately via `graphData` with `repoPath` and reference-based deduplication). Slices for inactive repos update silently — when the user returns to the tab, `switchRepo` instantly mirrors the fresh slice into `state`.

In the renderer `useAppState` is also per-repo: `slices: Map<repoPath, RepoSlice>` plus a global `meta`. Switching tabs immediately renders the new repo's slice (or empty if not populated yet) — no field of another repo can ever leak into `state`. Additionally:

- `runningOpsByRepo: Map<repoPath, operation>` — per-repo map of active operations. `state.isOperationRunning` and `state.currentOperation` are derived ONLY from the active tab. This fixes "I switched to B while fetch is running on A — buttons on B should not be disabled".
- `translateError(code, data, fallback)` — translates `error`-events with a localization code (`repoErrors.notARepo`, ...) via `t()` + `tpl()`. If the code is not in the locale, falls back to the `message` from main.
- `GitActivityIndicator` / `GitActivityDialog` accept `repoPath` as a prop and filter the snapshot by it: the activity log on tab A doesn't show operations from B, and vice versa.

## Logging

A two-sided system: both main and renderer log only in dev mode. In production the console stays silent — the user sees no noise in DevTools, and a packaged build does not pollute system stdout.

**Main** — `src/core/utils/Logger.ts`:

- Singleton `mainLogger` with levels `silent` < `error` < `warn` < `info` < `debug`. ERROR/WARN go to `console.error` (stderr), DEBUG/INFO to `console.log` (stdout).
- `configureMainLogger({ isProduction })` is called from `main.ts` after `app.whenReady`. Defaults: `app.isPackaged` → `silent`, dev → `debug`. ENV `SKYFORK_LOG_LEVEL=warn|info|debug|...` overrides the default — useful for debugging a packaged build on the user side without rebuilding.
- The file log `<userData>/logs/YYYY-MM-DD.log` is opened only at non-silent level (in prod nothing is written).
- All ad-hoc `console.warn/error` in core (FileWatcher, WorkerPool, handlersState, AiService, OpenAiCompatibleProvider, GitExecutor) were migrated to `mainLogger`. Direct `console.error` remains **only** in `process.on('unhandledRejection'/'uncaughtException')` — that is the last-resort handler that must work before `configureMainLogger`, so it can't be tied to the logger.

**Renderer** — `src/renderer/src/shared/logger.ts`:

- Prefix `[SkyFork]`. All methods (`debug`/`log`/`info`/`warn`/`error`) are no-ops in a Vite production build (`import.meta.env.DEV === false`). In dev — plain `console.*`.
- Used in `api.ts` (IPC error/warn) and `ErrorBoundary.tsx` (UI crash). Real UI errors flow through ErrorBoundary + the IPC `error` channel into main, where they end up in `mainLogger.error`.

**`perf.ts`** (both main and renderer) is a separate diagnostic tool with its own opt-in (`SKYFORK_PERF=1` / `window.__SKYFORK_PERF__ = true`). Not to be confused with the logging system: perf is enabled manually for measurements.
