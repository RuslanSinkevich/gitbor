> Русская версия: [docs/ru/architecture.md](ru/architecture.md)

## Overview

SkyFork is a 4-layer Electron application. Dependencies flow downward only.

## Layers

```
Renderer (React) → Preload (contextBridge) → Main (Node.js) → Git binary
```

- **Renderer** — React 18, Vite, CSS Modules. Feature folders: graph, sidebar, changes, diff, merge, blame, file-history, rebase, repo-manager, repo-tabs, toolbar, titlebar, layout, ssh, settings. State is driven by hooks: `useAppState`, `useMenuActions`, `useOperationToasts`, `useDiffState`, `useTheme`, `useToasts`, `useContextMenu`.

- **Preload** — `contextBridge.exposeInMainWorld('skyForkAPI', …)` exposes `invoke`, `onEvent`, `setLang`, and `platform` to the isolated renderer.

- **Main process** — Services are initialized in `main.ts`: `GitExecutor`, `StateManager`, `OperationQueue`, `SafetyNet`, `CommandHandler`, `MessageBridge`, `FileWatcher`. IPC handlers are wired through `MessageBridge`. Native menu is hidden (`autoHideMenuBar`) but retains keyboard accelerators.

- **Git** — Invoked as a child process via `execFile('git', args)`. `GitExecutor` handles execution, timeout, env passing, and logging.

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
| **GitExecutor** | Runs Git via `execFile`, ~30s timeout, env support, logs to file. |
| **GitParser** | Pure parsers: `parseCommits`, `parseBranches`, `parseTags`, `parseStatus`, `parseFileChanges`. |
| **GraphLayout** | Lane assignment for commit graph layout. |
| **DiffParser** | Turns unified diff text into `FileDiff` / `DiffHunk` / `DiffLine`. |
| **ConflictParser** | Parses conflict markers for the merge editor. |
| **GitConfig** | Reads/writes `user.name`, `user.email` (local/global scope). |
| **StateManager** | Single source of truth: branches, tags, stashes, remotes, status, commits, graph layout. Notifies subscribers on change. |
| **CommandHandler** | Orchestrates Git work; delegates to `readCommands` / `writeCommands`. |
| **MessageBridge** | Electron IPC: accepts `RendererCommand`, dispatches to `CommandHandler`, emits `MainEvent` to the renderer. Strictly typed via mapped types. |
| **OperationQueue** | Read ops may run in parallel; write ops are serialized. |
| **SafetyNet** | Auto-stash before risky operations; rollback paths on failure. |
| **FileWatcher** | `chokidar` on `.git` and the working tree; triggers state refresh. |
| **SshKeyManager** | Lists, generates, deletes SSH keys in `~/.ssh/`. |

## Renderer Modules

Feature folders under `src/renderer/src/features/`:

| Area | Contents |
|------|----------|
| **graph/** | `CommitGraph` (virtualized), `CommitDetails`, `branchPaths`. |
| **sidebar/** | Sidebar: branch tree, tags, stashes, remotes, submodules. |
| **changes/** | `LocalChanges` (tree), `CommitBar` (subject + description). |
| **diff/** | `DiffPanel`, `DiffView`, `DiffHunkView`, `DiffSideBySide`, `ImageDiff`. |
| **merge/** | `MergeDialog`, `MergeEditor`, `MergeBanner`, `ConflictPanel`. |
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

Custom hooks under `src/renderer/src/hooks/`:

| Hook | Role |
|------|------|
| **useAppState** | Global state from main process, IPC event handling. |
| **useMenuActions** | Unified handler for menu bar + keyboard accelerator actions. |
| **useOperationToasts** | Auto-shows toast notifications for git operation results. |
| **useDiffState** | Manages current diff target (file + hash). |
| **useTheme** | Dark/light theme toggle with localStorage persistence. |
| **useToasts** | Toast notification queue with auto-dismiss. |
| **useContextMenu** | Context menu state (position + items). |

## IPC Protocol

`RendererCommand` defines 45+ command types; `MainEvent` defines 30+ event types. Canonical definitions live in `src/core/bridge/messages.ts`. The renderer imports types from `src/renderer/src/types/index.ts` which re-exports from `@core/git/types` and `@core/bridge/messages`.

## State Management

`StateManager` in the main process owns the full `AppState`. On each meaningful change it pushes a snapshot via a `stateUpdate` event. The renderer's `useAppState` hook merges those payloads into local React state so the UI stays in sync without duplicating Git logic in the renderer.
