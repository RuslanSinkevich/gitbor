> Русская версия: [docs/ru/architecture.md](ru/architecture.md)

## Overview

SkyFork is a 4-layer Electron application. Dependencies flow downward only.

## Layers

```
Renderer (React) → Preload (contextBridge) → Main (Node.js) → Git binary
```

- **Renderer** — React 18, Vite, CSS Modules. Features: graph, sidebar, changes, diff, merge, blame, file-history, rebase, repo-manager, repo-tabs, toolbar. State is driven by the `useAppState` hook.

- **Preload** — `contextBridge.exposeInMainWorld('skyForkAPI', …)` exposes `invoke`, `onEvent`, `setLang`, and `platform` to the isolated renderer.

- **Main process** — Services are initialized in `main.ts`: `GitExecutor`, `StateManager`, `OperationQueue`, `SafetyNet`, `CommandHandler`, `MessageBridge`, `FileWatcher`. IPC handlers are wired through `MessageBridge`.

- **Git** — Invoked as a child process via `execFile('git', args)`. `GitExecutor` handles execution, timeout, and logging.

## Data Flow

```
User clicks button in React
  → postCommand({ type: 'stageFile', file: 'src/app.ts' })
  → api.ts → window.skyForkAPI.invoke(command)
  → preload/index.ts → ipcRenderer.invoke('skyfork:command', command)
  → MessageBridge.handleCommand(command)
  → CommandHandler.stageFile('src/app.ts')
  → writeCommands.stageFile() → git.exec(['add', 'src/app.ts'])
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
| **GitExecutor** | Runs Git via `execFile`, ~30s timeout, logs to file. |
| **GitParser** | Pure parsers: `parseCommits`, `parseBranches`, `parseTags`, `parseStatus`, `parseFileChanges`. |
| **GraphLayout** | Lane assignment for commit graph layout. |
| **DiffParser** | Turns unified diff text into `FileDiff` / `DiffHunk` / `DiffLine`. |
| **ConflictParser** | Parses conflict markers for the merge editor. |
| **StateManager** | Single source of truth: branches, tags, stashes, remotes, status, commits, graph layout. Notifies subscribers on change. |
| **CommandHandler** | Orchestrates Git work; delegates to `readCommands` / `writeCommands`. |
| **MessageBridge** | Electron IPC: accepts `RendererCommand`, dispatches to `CommandHandler`, emits `MainEvent` to the renderer. |
| **OperationQueue** | Read ops may run in parallel; write ops are serialized. |
| **SafetyNet** | Auto-stash before risky operations; rollback paths on failure. |
| **FileWatcher** | `chokidar` on `.git` and the working tree; triggers state refresh. |

## Renderer Modules

Feature folders under `src/renderer/src/features/`:

| Area | Contents |
|------|----------|
| **graph/** | `CommitGraph` (virtualized), `CommitDetails`, `branchPaths`. |
| **sidebar/** | Sidebar: branch tree, tags, stashes, remotes, submodules. |
| **changes/** | `LocalChanges` (tree), `CommitBar`. |
| **diff/** | `DiffPanel`, `DiffView`, `DiffHunkView`, `DiffSideBySide`, `ImageDiff`. |
| **merge/** | `MergeDialog`, `MergeEditor`, `MergeBanner`, `ConflictNotifyDialog`. |
| **blame/** | `BlameView`. |
| **file-history/** | `FileHistory`. |
| **rebase/** | `RebaseEditor`. |
| **repo-manager/** | `RepoManager`, recent repositories. |
| **repo-tabs/** | Multi-repo tabs. |
| **toolbar/** | Fetch, Pull, Push, Stash actions. |

## IPC Protocol

`RendererCommand` defines 35+ command types; `MainEvent` defines 25+ event types. Canonical definitions live in `src/core/bridge/messages.ts` on the main side; the renderer mirrors the contract in `src/renderer/src/types/ipc.ts`.

## State Management

`StateManager` in the main process owns the full `AppState`. On each meaningful change it pushes a snapshot via a `stateUpdate` event. The renderer’s `useAppState` hook merges those payloads into local React state so the UI stays in sync without duplicating Git logic in the renderer.
