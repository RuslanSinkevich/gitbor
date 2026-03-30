# SkyFork

> Русская версия: [docs/ru/](docs/ru/)

Free, open-source, cross-platform desktop Git client built on Electron. A Fork/GitKraken/SourceTree alternative.

Part of the Sky Platform ecosystem.

---

## Quick Start

```bash
cd skyfork
npm install
npm run dev
```

`npm run dev` starts Vite (renderer on port 5188) and Electron (main process) via `concurrently`.

### Build

```bash
npm run build        # Build renderer + main
npm start            # Run the built app
```

---

## Stack

| Component | Technology |
|-----------|-----------|
| Desktop runtime | Electron 28 |
| UI | React 18, TypeScript, Vite 5 |
| Styles | CSS Modules, `--sg-*` custom properties |
| File watcher | chokidar |
| Settings | electron-store |
| Git | Bundled git binary (`resources/git/{platform}/git`) |

---

## Architecture

4 layers, dependencies flow downward only:

```
┌─────────────────────────────────────────────┐
│  Renderer Process (React)                   │
│  UI: Sidebar, Graph, Changes, Diff, Toolbar │
├─────────────────────────────────────────────┤
│  Preload Script                             │
│  contextBridge (secure IPC bridge)          │
├─────────────────────────────────────────────┤
│  Main Process (Node.js)                     │
│  Application + Safety + Git Layer           │
├─────────────────────────────────────────────┤
│  Bundled Git                                │
│  resources/git/{platform}/git               │
└─────────────────────────────────────────────┘
```

### Data Flow

```
App.tsx → api.invoke() → preload (ipcRenderer) → MessageBridge (ipcMain)
  → CommandHandler → GitExecutor → git binary
```

---

## Project Structure

```
skyfork/
├── src/
│   ├── core/                      # Backend (Main Process)
│   │   ├── bridge/                # IPC bridge (MessageBridge, messages)
│   │   ├── commands/              # Command orchestration (checkout, commit, merge, diff...)
│   │   │   ├── CommandHandler.ts  # Main command dispatcher
│   │   │   ├── ConflictManager.ts # Merge conflicts
│   │   │   ├── readCommands.ts    # Read operations (log, status, branches)
│   │   │   └── writeCommands.ts   # Write operations (commit, push, merge)
│   │   ├── git/                   # Git layer
│   │   │   ├── GitExecutor.ts     # Run git processes
│   │   │   ├── GitParser.ts       # Parse git output
│   │   │   ├── GraphLayout.ts     # Commit graph layout algorithm
│   │   │   ├── DiffParser.ts      # Parse unified diff
│   │   │   ├── ConflictParser.ts  # Parse conflict markers
│   │   │   ├── BlameParser.ts     # Parse git blame
│   │   │   ├── FileHistoryParser.ts # File history
│   │   │   ├── RebaseManager.ts   # Rebase operations
│   │   │   ├── SubmoduleParser.ts # Parse submodules
│   │   │   └── types/             # Types: Commit, Branch, Tag, GraphNode, etc.
│   │   ├── safety/                # 5 levels of data protection
│   │   │   ├── OperationQueue.ts  # Queue: reads parallel, writes serial
│   │   │   ├── OperationJournal.ts # WAL operation journal
│   │   │   ├── SafetyNet.ts       # Auto-stash + rollback
│   │   │   └── RecoveryManager.ts # Startup checks (locks, journal, rebase)
│   │   ├── state/
│   │   │   ├── StateManager.ts    # Single source of truth, multi-repo
│   │   │   └── FileWatcher.ts     # File watcher (chokidar, debounce 300ms)
│   │   └── utils/
│   │       └── Logger.ts          # File logging
│   │
│   ├── main/                      # Electron entry point
│   │   ├── main.ts                # Window creation, service init
│   │   ├── menu.ts                # Native menu
│   │   └── i18n/                  # Menu localization (ru, en)
│   │
│   ├── preload/
│   │   └── index.ts               # contextBridge.exposeInMainWorld('skyForkAPI')
│   │
│   └── renderer/                  # Frontend (React)
│       ├── src/
│       │   ├── App.tsx            # Root component
│       │   ├── api.ts             # skyForkAPI wrapper (invoke, onEvent)
│       │   ├── features/          # Feature modules
│       │   │   ├── graph/         # Commit graph (virtualized)
│       │   │   ├── sidebar/       # Sidebar (branches, tags, stash, remotes)
│       │   │   ├── changes/       # Changed files (tree view)
│       │   │   ├── diff/          # Diff viewer (inline + split)
│       │   │   ├── merge/         # Merge conflict resolution
│       │   │   ├── toolbar/       # Toolbar actions
│       │   │   ├── blame/         # Git blame
│       │   │   ├── file-history/  # File history
│       │   │   ├── rebase/        # Interactive rebase editor
│       │   │   ├── repo-manager/  # Repository management
│       │   │   └── repo-tabs/     # Multi-repo tabs
│       │   ├── ui/                # UI kit (SgButton, SgDialog, SgToast...)
│       │   ├── hooks/             # React hooks
│       │   ├── i18n/              # UI localization (ru, en)
│       │   ├── styles/            # Global styles, CSS variables
│       │   ├── types/             # TypeScript types for renderer
│       │   └── pages/
│       │       └── showcase/      # UI Showcase (component demos)
│       ├── package.json
│       └── vite.config.ts
│
├── docs/                          # Documentation
│   ├── getting-started.md         # Setup and dev workflow
│   ├── architecture.md            # Architecture overview
│   ├── features.md                # Feature list
│   ├── contributing.md            # Contributing guide
│   ├── ru/                        # Russian translations
│   └── internal/                  # Internal module docs
│
├── dist/                          # Build output
├── package.json                   # Electron 28, TypeScript 5.3
└── tsconfig.json
```

---

## Safety: 5 Levels of Protection

1. **Git reflog** — built-in, 90 days
2. **Auto-stash** — saves uncommitted changes before destructive operations
3. **HEAD hash** — saved for rollback
4. **WAL journal** — `.git/SkyFork-journal.json`, begin/complete/fail
5. **RecoveryManager** — startup checks: lock files, incomplete operations, rebase, merge

---

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Prerequisites, setup, dev workflow, adding features |
| [Architecture](docs/architecture.md) | 4-layer design, data flow, core & renderer modules |
| [Features](docs/features.md) | What SkyFork can do: graph, diff, merge, blame, etc. |
| [Contributing](docs/contributing.md) | Code style, conventions, PR checklist |

Russian translations: [`docs/ru/`](docs/ru/)

Internal module docs: [`docs/internal/`](docs/internal/INDEX.md)

---

## Status

Version 0.1.0. Backend ready, UI in active development. Not production-tested.

## License

MIT
