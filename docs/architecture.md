> Русская версия: [docs/ru/architecture.md](ru/architecture.md)

## Overview

GitBor is a 4-layer Electron application. Dependencies flow downward only.

## Layers

```
Renderer (React) → Preload (contextBridge) → Main (Node.js) → Git binary
```

- **Renderer** — React 18, Vite, CSS Modules. Feature folders: graph, sidebar, changes (with extracted `fileTreeModel.ts`), diff, merge, blame, file-history, rebase, repo-manager, repo-tabs, toolbar, titlebar, layout, ssh, settings, ai. State is driven by `useAppState` (a facade over `useRepoSlices` + `useRunningOps` + `useStateSubscription`) plus `useMenuActions`, `useKeyboardShortcuts`, `useOperationToasts`, `useDiffState`, `useTheme`, `useToasts`, `useContextMenu`, `useDialogs`, `useAutoFetch`.

- **Preload** — `contextBridge.exposeInMainWorld('gitBorAPI', …)` exposes `invoke`, `onEvent`, and `platform` to the isolated renderer.

- **Main process** — Services are initialized in `main.ts`: `RepoServicesRegistry` (per-repo `GitExecutor` / `OperationQueue` / `SafetyNet`), `StateManager` (facade over `RepoSlicesStore` + `RepoStateRefresher` + `RepoEventBus`), `CommandHandler`, `MessageBridge` (with handlers split into `bridge/ipc/`), `FileWatcher`, `WorkerPool` for parser offload, `AiConfigStore` + `AiService` + `AiHandlers` for AI commit messages. IPC is routed through `MessageBridge`. No native menu — `Menu.setApplicationMenu(null)`. All menus and keyboard shortcuts live in the renderer.

- **Git** — Invoked as a child process via `execFile('git', args)`. `GitExecutor` handles execution, timeout, env passing, and logging. `cwd` is fixed at construction — each repo gets its own `GitExecutor` so switching the active repo never drags one executor between paths.

## Data Flow

```
User clicks button in React
  → postCommand({ type: 'stageFile', file: 'src/app.ts' })
  → api.ts → window.gitBorAPI.invoke(command)
  → preload/index.ts → ipcRenderer.invoke('gitbor:command', command)
  → MessageBridge.handleCommand(command)
  → CommandHandler.stageFile('src/app.ts')
  → writeCommands.stageFile() → git.exec(['add', '--', 'src/app.ts'])
  → StateManager.refreshStatusAndNotify()
  → MessageBridge.send({ type: 'stateUpdate', data: newState })
  → preload → ipcRenderer.on('gitbor:event')
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
| **StateManager** | Thin facade. Public surface (`getState`, `getActiveServices`, `getGit`, `getRegistry`, `refresh*`, `switchRepo`, `setRepoPath`, `setOpenRepos`, `clearRepo`, `subscribe`, `onRepoSwitch`, `onRepoClose`, `notifyRepoClose`, `invalidateGraphCache`, `setOperationRunning`) is preserved 1:1, but the body now delegates to three independent classes (see below). |
| **RepoSlicesStore** | `Map<repoPath, RepoSlice>` + shared `meta` (`openRepos`, `activeRepoIndex`) + the mirror function that exposes the active slice as a single `AppState`. Extracted from `StateManager`. |
| **RepoStateRefresher** | All async `refresh*` methods (`refreshAll`, `refreshStatus`, `refreshCommits`, `refreshBranches`, ...). Each method takes `repoPath` and updates a specific slice; before any work it checks `isRepoTracked(repoPath)` so a background refresh can never resurrect a just-closed repo. Owns `runSwitchRepoColdPhase` and `invalidateGraphCache`. |
| **RepoEventBus** | Three subscription channels: `state` (any change), `switch` (active repo changed), `close` (repo removed). Used by `MessageBridge`, `FileWatcher`, recovery flows. |
| **repoSlice** | The `RepoSlice` interface + `emptyRepoSlice` / `mirrorRepoSliceToAppState` / git-format constants (`GIT_LOG_FORMAT`, `GIT_REF_FORMAT`, `GIT_TAG_REF_FORMAT`, `GIT_STASH_FORMAT`) + `hashGitStdout` for `git log` deduplication. |
| **CommandHandler** | Orchestrates Git work; delegates to `readCommands` / `writeCommands`. All executors (`git`/`queue`/`safety` plus `RebaseManager`/`ConflictManager`/...) are looked up per-call via `state.getActiveServices()` — no mutable class fields tied to a single repo. `openRepo` throws `AppError('repoErrors.notARepo', { path })` with a localization code when the path is not a Git repo. |
| **MessageBridge** | Electron IPC: a thin ~150-line wrapper. Accepts `RendererCommand`, looks up the handler in `ipcCommandHandlers` (aggregated from `bridge/ipc/handlersState.ts`, `handlersGitOps.ts`, `handlersRepoExtras.ts`, `handlersAi.ts`). Catches `AppError` and emits an `error`-event with `code`+`data` for renderer-side translation. Sends `graphData` with reference-based deduplication (`sentGraphByRepo`) — repeatedly toggling A→B→A doesn't push megabytes of JSON over IPC. |
| **bridge/ipc/** | IPC handler submodules: `helpers.ts` (`runTracked`/`op`/`opWithPostMerge`/`errOnFail`/`mergeStateAfter`), `ready.ts`, `handlersState.ts` (lifecycle, diff/blame/history), `handlersGitOps.ts` (push/pull/fetch/commit/stage/merge/rebase), `handlersRepoExtras.ts` (LFS, worktrees, hooks, stats, bisect, repo-tabs, settings, SSH), `handlersAi.ts`. `op`/`opWithPostMerge` snapshot `repoPath` BEFORE starting and pass it into both `operationStart` and `operationEnd` so a tab switch between events doesn't break the per-repo running flag. |
| **OperationQueue** | Per-repo: read ops parallel, writes serialized. A separate queue per repo means blocking one repo cannot block another. |
| **SafetyNet** | Per-repo. Auto-stash before risky operations; rollback paths on failure. |
| **FileWatcher** | Per-repo `chokidar` watchers (`.git` + worktree, created lazily via `setImmediate` after a pre-scan). The worktree watcher is NOT started when `isDangerousRepoRoot(path)` is true (home, drive root, `C:\Windows`...) or when there are > 1000 top-level entries — otherwise an `EPERM`/`EACCES` cascade on `AppData`/`OneDrive` would crash main. Strict race-guard: if the repo is closed while async pre-scan is still running, no new watchers are created (or they are closed immediately). `chokidar.on('error')` swallows EPERM, depth=3, debounce: 50ms `.git`, 200ms worktree. |
| **repoPathGuard** | `isDangerousRepoRoot(path)` — checks whether a path is "dangerous" (drive root / home / Windows / `Program Files` / `node_modules` / etc.). Used by `FileWatcher` to skip the worktree watcher. Opening such folders is no longer hard-blocked — the user is allowed to look at any directory on purpose. |
| **AppError** | Structured error with a localization code (`code`) and template params (`data`) plus a technical fallback. `MessageBridge` turns it into an `error`-event with `code`/`data`; the renderer translates via `locale.repoErrors[code]` and interpolates `data`. Replaces "English-only strings that nobody translates". |
| **gitActivityStore** | Journal of git operations (start/append/finish) with `repoPath` per entry. `activityContext.ts` uses `AsyncLocalStorage` so `GitExecutor.exec` can attribute every command to its active operation without explicit id propagation. The renderer filters by the active tab's `repoPath`; cap = 100 entries; stdout/stderr truncated to `OUTPUT_CAP_BYTES = 16 KiB` with a `[truncated...]` marker. |
| **Logger** | Levelled logging (`silent`/`error`/`warn`/`info`/`debug`) with stdout/stderr split and an optional `WriteStream` to `<userData>/logs/YYYY-MM-DD.log`. Singleton `mainLogger` is the single source of level for all modules. `configureMainLogger({ isProduction })` is called from `main.ts` after `app.whenReady`: prod → `silent` (silent in both console and file), dev → `debug`. ENV `GITBOR_LOG_LEVEL` overrides the default — convenient for debugging on a packaged build at the user side. All ad-hoc `console.warn/error` in core (FileWatcher, WorkerPool, AiService, etc.) were migrated to `mainLogger`. Direct `console.error` remains only inside `process.on('unhandledRejection'/'uncaughtException')` — that is the last-resort handler that must run BEFORE `configureMainLogger`. |
| **SshKeyManager** | Lists, generates, deletes SSH keys in `~/.ssh/`. Two-step passphrase generation (no passphrase in argv). |
| **ReflogParser** | Parses `git reflog` output into structured entries. |
| **BisectManager** | Manages `git bisect` sessions: start, good, bad, skip, reset. |
| **HooksManager** | Lists, toggles (enable/disable), reads git hooks content. |
| **WorktreeManager** | Lists, adds, removes git worktrees. |
| **LfsManager** | Git LFS status, track/untrack patterns, list managed files. |
| **pathSecurity** | Path validation: `safePath` (traversal + symlink via `realpathSync.native` + Windows case-insensitive), `isSafeFilename`. |
| **AtomicWrite** | Atomic file writes via tmp+rename with fsync. Windows retry uses `Atomics.wait` (no busy-spin). |
| **AiService** | Facade over `AiProvider`. `isConfigured()` checks the active mode (`openai-compatible` requires `baseUrl + model`; `qwen-web` requires `qwenWebToken + model`). `generateCommitMessage` builds prompts with the configured `commitLanguage`, calls the provider, and post-processes the result (strips ```` ``` ```` fences and surrounding quotes). |
| **AiHandlers** | Per-`requestId` `AbortController` map. `getConfig` masks the secret (`apiKey` / `qwenWebToken` → `••••••••`) before sending to the renderer. `setConfig` merges secrets: a masked or empty value from the UI means "keep the previous secret". `cancelAll()` aborts every inflight generation on shutdown. |
| **AiConfigStore** | Persistent config in `{userData}/ai-config.json` with `version: 3` (`migrateToV3` upgrades older files on load). Atomic write via `atomicWriteJSON`. Secrets are encrypted via Electron `safeStorage` (DPAPI / Keychain / libsecret); when unavailable, falls back to a `plain:` prefix so keys remain readable for diagnostics. `clear()` writes an empty entry rather than deleting the file. |
| **OpenAiCompatibleProvider** | `/v1/chat/completions` with SSE streaming. Used by OpenAI, Ollama, LM Studio, DeepSeek, Groq. Reports `usage` and `finishReason` (`stop`/`length`/`error`/`aborted`). |
| **QwenWebProvider** | Unofficial bridge to `chat.qwen.ai`. Two-step flow: `POST /api/v2/chats/new` to create a chat id, then `POST /api/v2/chat/completions?chat_id=…` with SSE. Uses the session token from `localStorage` (no DashScope API key). Falls back to `qwen3-max` for unknown model ids. |

## Renderer Modules

Feature folders under `src/renderer/src/features/`:

| Area | Contents |
|------|----------|
| **graph/** | `CommitGraph` (virtualized), `CommitDetails`, `branchPaths`. |
| **sidebar/** | Sidebar: `BranchTree` (current branch as a green dot, no text badge), tags, stashes, remotes, submodules. |
| **changes/** | `LocalChanges` (tree, folder context menu applies to all files inside), `CommitBar` (subject + description), `FileTree` + extracted pure helpers in `fileTreeModel.ts` (`buildFileTree`, `collectFiles`). |
| **diff/** | `DiffPanel`, `DiffView`, `DiffHunkView`, `DiffSideBySide` (each hunk = `.hunkBlock` with `HunkActionsOverlay` shown on `:hover`/`:focus-within` — Fork-style; no persistent `@@` header bar; no `+`/`−` text prefix in line content — color-only), `HunkActionsOverlay` (shared Stage / Discard / Unstage panel — single source of truth for both inline and split), `ImageDiff`. |
| **merge/** | `MergeDialog`, `MergeEditor`, `MergeBanner`, `ConflictPanel`. |
| — | **`AppDialogs.tsx`** — all modal dialogs extracted from `App.tsx` for cleaner separation of concerns. |
| **blame/** | `BlameView`. |
| **file-history/** | `FileHistory`. |
| **rebase/** | `RebaseEditor`. |
| **repo-manager/** | `RepoManager`, recent repositories. |
| **repo-tabs/** | Multi-repo tabs. The `+` tab opens `RepoManager`; clicking the active tab again also opens it. Highlight on the `+` button when manager is active. |
| **toolbar/** | Fetch, Pull, Push, Stash (opens `SgPromptDialog` with `allowEmpty` — empty value = `git stash` without `-m`). |
| **titlebar/** | `TitleBar` with custom `MenuBar` component. |
| **layout/** | `CommitsView`, `ChangesView`, `RightPanelContent`. |
| **ssh/** | `SshKeysDialog` — SSH key management UI. |
| **settings/** | `RepoSettingsDialog` — repository user.name/email settings. |
| **ai/** | `AiSettingsDialog` (preset `select` with Cloud/Local/Web optgroups + Custom; switches between OpenAI-compatible and Qwen Web modes), `AiGenerateButton` (in `CommitBar`), `useAiConfig` hook, `presets.ts` with `detectPreset(mode, baseUrl, model)`, `errors.ts` for translating `AiError.kind` to UI messages. |
| **reflog/** | `ReflogDialog`, `ReflogTable`, `ReflogRow`, `ActionBadge`. |
| **bisect/** | `BisectDialog`, `BisectStartForm`, `BisectActiveSession`. |
| **hooks/** | `HooksDialog`, `HookItem`. |
| **worktrees/** | `WorktreesDialog`, `WorktreeItem`, `AddWorktreeForm`. |
| **lfs/** | `LfsDialog`, `LfsPatternList`, `LfsFileList`. |
| **gitignore/** | `GitignoreDialog`, templates. |

Custom hooks under `src/renderer/src/hooks/`:

| Hook | Role |
|------|------|
| **useAppState** | Thin facade. Composes the three hooks below, holds transient state (`commitDetail`, `mergeState`, `error`, `viewOverride`, `rebase`, `recovery`, `pendingOpenDiff`/`MergeEditor`), assembles the derived `AppState`, exposes `switchRepoFast` and `resetTransientState`. The public surface (return shape) didn't change — `App.tsx` and consumers don't notice the split. |
| **useRepoSlices** | `slices: Map<repoPath, RepoSlice>` + `meta` (`openRepos`, `activeRepoIndex`) + helpers (`replaceSlice`, `updateSlice`, `removeSlice`, `applyMetaPatch`). Swapping the active tab is just `setActiveRepoIndex(i)` — UI re-renders against the new slice (or `EMPTY_SLICE` if unpopulated). |
| **useRunningOps** | Per-repo `runningOpsByRepo: Map<repoPath, operation>`. Exposes `getCurrentOp(repoPath)` so `state.isOperationRunning` can be derived from the active tab only. Holds `lastOpResult` for `useOperationToasts`. |
| **useStateSubscription** | The single `onMainEvent` listener and dispatcher: routes `stateUpdate`, `graphData`, `repoSwitch`, `repoClose`, `commitDetail`, `mergeState`, `rebaseProgress`, `recoveryIssues`, `error`, `operationStart`/`operationEnd`, `openDiff`, `openMergeEditor` to the corresponding hook setters. Created once per session — no re-subscription on prop changes. |
| **useMenuActions** | Unified handler for menu bar actions (dispatch by action string). |
| **useKeyboardShortcuts** | Maps keyboard shortcuts (Ctrl+O, Ctrl+Shift+F, F5, etc.) to menu actions. Skips in input/textarea/contentEditable. |
| **useOperationToasts** | Auto-shows toast notifications for git operation results. |
| **useDiffState** | Manages current diff target (file + hash). |
| **useTheme** | Dark/light theme toggle with localStorage persistence. |
| **useToasts** | Toast notification queue with auto-dismiss. |
| **useContextMenu** | Context menu state (position + items). |
| **useDialogs** | Centralized dialog visibility states (about, ssh, reflog, bisect, hooks, worktrees, lfs, gitignore, ai). |
| **useAutoFetch** | Periodic background `fetch` for the active repo (configurable interval). |
| **useAiConfig** | Loads/saves `AiProviderConfig`; exposes `testConnection` and `generateCommitMessage` with streaming `onChunk`. |

## AI Module

`src/core/ai/`. The module is independent: providers live behind a small `AiProvider` interface, the rest of the app talks to `AiHandlers` over IPC.

- **Modes** — `openai-compatible` (any `/v1/chat/completions` endpoint: OpenAI, Ollama, LM Studio, DeepSeek, Groq) and `qwen-web` (chat.qwen.ai via session token).
- **`AiProviderConfig`** — `mode`, `baseUrl`, `apiKey`, `qwenWebToken?`, `model`, `aiResponseLanguage` (`auto`/`en`/`ru`; legacy `commitLanguage` kept for v2 migration), `headers?`, `timeoutMs?`.
- **Prompts** (`prompts.ts`) — `buildCommitSystemPrompt(language)` includes language-specific rules; `buildCommitUserPrompt(diff, language)` truncates the diff to `MAX_DIFF_CHARS = 6000` (head 70% + tail 20% with a `[diff truncated, N chars omitted]` marker in the middle); the user prompt repeats the language hint because small/quantized local models often forget the system prompt.
- **`AiService.generateCommitMessage`** — calls the provider, then `postProcessCommit` strips ```` ``` ```` fences and surrounding quotes (models love to wrap the answer even when asked for plain text).
- **Streaming** — both providers stream via SSE (`onChunk(delta)`). The renderer renders chunks live in the commit subject field.
- **Cancellation** — `AiHandlers` keeps a `Map<requestId, AbortController>`. The UI calls `aiCancel(requestId)` when the user clicks Stop or closes the dialog.
- **Persistence** — `AiConfigStore` writes `{userData}/ai-config.json` atomically (`atomicWriteJSON`). Secrets are encrypted via Electron `safeStorage` with `enc:`-prefix; if the system key store is unavailable, we fall back to `plain:`-prefix and log a warning.
- **Secret masking** — `AiHandlers.getConfig` returns the config with `apiKey`/`qwenWebToken` replaced by `••••••••` so the renderer never sees the real value. `setConfig` uses `mergeSecrets`: a masked or empty value coming back from the UI is interpreted as "keep the previous secret".
- **IPC commands** — `aiGetConfig`, `aiSetConfig`, `aiTestConnection`, `aiGenerateCommitMessage`, `aiCancel`. Events: `aiConfig`, `aiTestResult`, `aiChunk`, `aiResult`, `aiError`. Handlers live in `bridge/ipc/handlersAi.ts`.

## IPC Protocol

`RendererCommand` defines 45+ command types; `MainEvent` defines 30+ event types. Canonical definitions live in `src/core/bridge/messages.ts`. The renderer imports types from `src/renderer/src/types/index.ts` which re-exports from `@core/git/types` and `@core/bridge/messages`.

## State Management

**In main**, `StateManager` is a thin facade. It composes:

- `RepoSlicesStore` — per-repo slices (`slicesByRepo`) plus shared `meta` (`openRepos`, `activeRepoIndex`).
- `RepoStateRefresher` — all async `refresh*` methods. `RepoStateRefresher.runSwitchRepoColdPhase(repoPath)` is the heavy work after a tab switch (full status + log + branches + tags); cheap `mirror+notify` happens immediately in `switchRepo`.
- `RepoEventBus` — three channels: `state` (any change), `switch` (active repo changed), `close` (repo removed).

Each meaningful change of the active repo emits `stateUpdate` (without `commits`/`graphLayout` — those flow separately via `graphData` with `repoPath` and reference-based deduplication in `MessageBridge.sentGraphByRepo`). Slices for inactive repos update silently — when the user returns to the tab, `switchRepo` instantly mirrors the fresh slice into `state`.

**In the renderer** `useAppState` is also a thin facade. It composes:

- `useRepoSlices` — `slices: Map<repoPath, RepoSlice>` plus a global `meta`.
- `useRunningOps` — `runningOpsByRepo: Map<repoPath, operation>`. `state.isOperationRunning` and `state.currentOperation` are derived ONLY from the active tab. This fixes "I switched to B while fetch is running on A — buttons on B should not be disabled".
- `useStateSubscription` — single `onMainEvent` listener / dispatcher created once per session.

Switching tabs immediately renders the new repo's slice (or empty if not populated yet) — no field of another repo can ever leak into `state`. Additionally:

- `translateError(code, data, fallback)` — translates `error`-events with a localization code (`repoErrors.notARepo`, ...) via `t()` + `tpl()`. If the code is not in the locale, falls back to the `message` from main.
- `GitActivityIndicator` / `GitActivityDialog` accept `repoPath` as a prop and filter the snapshot by it: the activity log on tab A doesn't show operations from B, and vice versa.

## Session Persistence

Open tabs survive restart. State lives in renderer's `localStorage` (`sg-open-repos` — array of paths, capped at 50; `sg-last-active-repo` — string). Helpers in `features/repo-manager/recentRepos.ts`: `loadOpenRepos` / `saveOpenRepos` / `clearOpenRepos`.

- On every change of `state.openRepos`, `App.tsx` flushes the path list to `sg-open-repos`.
- On startup, `App.tsx` reads `sg-open-repos` and re-opens each repo via `invokeCommand({type:'openRepo'})` (sequential, failures are silently dropped — the next save rewrites the list without the missing path). The active tab is restored separately by matching `sg-last-active-repo` against the populated `state.openRepos` (path comparison is case-insensitive and slash-normalized via `sameRepoPath`).
- `sg-last-active-repo` is kept as a single-tab fallback for users whose `sg-open-repos` is empty (older sessions before this feature).

`autoOpenRepo()` in `main.ts` (which probes `process.cwd()` for a git repo) is now **dev-only** (`return` if `app.isPackaged`). Without this guard, a packaged build launched from a Start Menu shortcut would resolve `cwd` to `%USERPROFILE%` (or the shortcut's "start in" dir) and silently auto-open whatever git repo happened to live there — masking the real persisted session.

## Startup

`app.whenReady` parallelizes the two heaviest startup steps:

- `createWindow()` — Electron GPU init + `BrowserWindow` allocation.
- `initServices()` — `git --version` probe, `RepoServicesRegistry`, `StateManager`, `MessageBridge`, `FileWatcher`, AI services.

Both run concurrently. `messageBridge.attach(mainWindow)` is called after `createWindow` resolves but before `loadWindow()`, so `ipcMain.handle('gitbor:command')` is registered by the time React mounts and fires the first `postCommand`. `autoOpenRepo()` is not awaited — it kicks off in the background and pushes events through the already-attached bridge. Cuts ~0.5–1.5 s off cold-start on Windows.

## Logging

A two-sided system: both main and renderer log only in dev mode. In production the console stays silent — the user sees no noise in DevTools, and a packaged build does not pollute system stdout.

**Main** — `src/core/utils/Logger.ts`:

- Singleton `mainLogger` with levels `silent` < `error` < `warn` < `info` < `debug`. ERROR/WARN go to `console.error` (stderr), DEBUG/INFO to `console.log` (stdout).
- `configureMainLogger({ isProduction })` is called from `main.ts` after `app.whenReady`. Defaults: `app.isPackaged` → `silent`, dev → `debug`. ENV `GITBOR_LOG_LEVEL=warn|info|debug|...` overrides the default — useful for debugging a packaged build on the user side without rebuilding.
- The file log `<userData>/logs/YYYY-MM-DD.log` is opened only at non-silent level (in prod nothing is written).
- All ad-hoc `console.warn/error` in core (FileWatcher, WorkerPool, handlersState, AiService, OpenAiCompatibleProvider, GitExecutor) were migrated to `mainLogger`. Direct `console.error` remains **only** in `process.on('unhandledRejection'/'uncaughtException')` — that is the last-resort handler that must work before `configureMainLogger`, so it can't be tied to the logger.

**Renderer** — `src/renderer/src/shared/logger.ts`:

- Prefix `[GitBor]`. All methods (`debug`/`log`/`info`/`warn`/`error`) are no-ops in a Vite production build (`import.meta.env.DEV === false`). In dev — plain `console.*`.
- Used in `api.ts` (IPC error/warn) and `ErrorBoundary.tsx` (UI crash). Real UI errors flow through ErrorBoundary + the IPC `error` channel into main, where they end up in `mainLogger.error`.

**`perf.ts`** (both main and renderer) is a separate diagnostic tool with its own opt-in (`GITBOR_PERF=1` / `window.__GITBOR_PERF__ = true`). Not to be confused with the logging system: perf is enabled manually for measurements.
