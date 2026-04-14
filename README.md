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

### Tests

```bash
npm test             # Run all tests (Vitest)
npx vitest           # Watch mode
```

### Distribution

```bash
npm run dist:win     # Windows (NSIS + portable)
npm run dist:mac     # macOS (DMG)
npm run dist:linux   # Linux (AppImage + deb)
```

---

## Stack

| Component | Technology |
|-----------|-----------|
| Desktop runtime | Electron 28 |
| UI | React 18, TypeScript, Vite 5 |
| Styles | CSS Modules, `--sg-*` custom properties |
| File watcher | chokidar |
| Git | Bundled git binary (`resources/git/{platform}/git`) |

---

## Architecture

4 layers, dependencies flow downward only:

```
┌──────────────────────────────────────────────────────────┐
│  Renderer Process (React)                                │
│  UI: Menu, Sidebar, Graph, Changes, Diff, Merge, SSH    │
├──────────────────────────────────────────────────────────┤
│  Preload Script                                          │
│  contextBridge (secure IPC bridge)                       │
├──────────────────────────────────────────────────────────┤
│  Main Process (Node.js)                                  │
│  Application + Safety + Git Layer + SSH Key Manager      │
├──────────────────────────────────────────────────────────┤
│  Bundled Git                                             │
│  resources/git/{platform}/git                            │
└──────────────────────────────────────────────────────────┘
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
│   │   │   ├── GitConfig.ts       # Read/write git config (user.name, user.email)
│   │   │   ├── GraphLayout.ts     # Commit graph layout algorithm
│   │   │   ├── DiffParser.ts      # Parse unified diff
│   │   │   ├── ConflictParser.ts  # Parse conflict markers
│   │   │   ├── BlameParser.ts     # Parse git blame
│   │   │   ├── FileHistoryParser.ts # File history
│   │   │   ├── RebaseManager.ts   # Rebase operations
│   │   │   ├── SubmoduleParser.ts # Parse submodules
│   │   │   └── types/             # Types: Commit, Branch, Tag, GraphNode, etc.
│   │   ├── ssh/                   # SSH key management
│   │   │   └── SshKeyManager.ts   # List, generate, delete SSH keys
│   │   ├── safety/                # 5 levels of data protection
│   │   │   ├── OperationQueue.ts  # Queue: reads parallel, writes serial
│   │   │   ├── OperationJournal.ts # WAL operation journal
│   │   │   ├── SafetyNet.ts       # Auto-stash + rollback
│   │   │   └── RecoveryManager.ts # Startup checks (locks, journal, rebase)
│   │   ├── state/
│   │   │   ├── StateManager.ts    # Single source of truth, multi-repo
│   │   │   └── FileWatcher.ts     # File watcher (chokidar, debounce 300ms)
│   │   └── utils/
│   │       ├── Logger.ts          # File logging
│   │       └── pathSecurity.ts    # Path traversal protection (safePath, isSafeFilename)
│   │
│   ├── main/                      # Electron entry point
│   │   └── main.ts                # Window creation, service init, no native menu
│   │
│   ├── preload/
│   │   └── index.ts               # contextBridge.exposeInMainWorld('skyForkAPI')
│   │
│   └── renderer/                  # Frontend (React)
│       ├── src/
│       │   ├── App.tsx            # Root component (composition only)
│       │   ├── api.ts             # skyForkAPI wrapper (invoke, onEvent)
│       │   ├── features/          # Feature modules
│       │   │   ├── graph/         # Commit graph (virtualized)
│       │   │   ├── sidebar/       # Sidebar (branches, tags, stash, remotes)
│       │   │   ├── changes/       # Changed files (tree), CommitBar (subject + desc)
│       │   │   ├── diff/          # Diff viewer (inline + split, ignore whitespace)
│       │   │   ├── merge/         # Merge conflict resolution (ConflictPanel, MergeEditor)
│       │   │   ├── toolbar/       # Toolbar actions
│       │   │   ├── blame/         # Git blame
│       │   │   ├── file-history/  # File history
│       │   │   ├── rebase/        # Interactive rebase editor
│       │   │   ├── repo-manager/  # Repository management
│       │   │   ├── repo-tabs/     # Multi-repo tabs
│       │   │   ├── titlebar/      # Custom menu bar (replaces native Electron menu)
│       │   │   ├── layout/        # CommitsView, ChangesView, RightPanelContent
│       │   │   ├── ssh/           # SSH Keys Manager dialog
│       │   │   └── settings/      # Repository Settings dialog
│       │   ├── ui/                # UI kit (SgButton, SgDialog, SgToast, MenuBar...)
│       │   ├── hooks/             # React hooks (useAppState, useMenuActions, useOperationToasts...)
│       │   ├── i18n/              # UI localization (ru, en)
│       │   ├── styles/            # Global styles, CSS variables, themes
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

## Key Features

- **Commit graph** — virtualized scroll, branch coloring, search
- **Branch/Tag/Stash sidebar** — tree view, checkout, merge, rename, delete
- **Local changes** — tree view, stage/unstage/discard per file and per hunk
- **Diff viewer** — inline + split, ignore whitespace, stage hunk
- **Merge conflict resolution** — two-column editor, auto-advance, conflict prediction
- **File history & Git blame** — per-file commit history, line-by-line annotations
- **Interactive rebase** — pick/reword/edit/squash/fixup/drop, progress banner
- **Multi-repo tabs** — open multiple repositories simultaneously
- **Custom menu bar** — HTML/CSS menu with Edit actions, keyboard shortcuts (no native menu)
- **SSH Keys Manager** — generate, view, copy, delete SSH keys
- **Repository Settings** — user.name/email, global/local toggle
- **Toast notifications** — success/error feedback for all git operations
- **Confirmation dialogs** — destructive actions require confirmation
- **Shell integration** — open in Explorer/Terminal, refresh (F5)
- **Error boundary** — React ErrorBoundary prevents blank screens
- **Reflog** — HEAD history with restore
- **Git Bisect** — interactive binary search for buggy commits
- **Git Hooks** — view and enable/disable hooks
- **Signed commits** — GPG/SSH verification badges in graph
- **Worktrees** — manage multiple working trees
- **Git LFS** — large file tracking
- **.gitignore editor** — templates for Node, Python, Java, Rust, Go, IDE, OS
- **Compare two commits** — diff between arbitrary commits
- **Arrow key navigation** — ↑/↓ in commit graph
- **i18n** — English and Russian
- **Themes** — dark and light mode
- **Distribution** — electron-builder for Win/Mac/Linux

---

## Data Safety

### 5 Levels of Protection

1. **Git reflog** — built-in, 90 days
2. **Auto-stash** — saves uncommitted changes before destructive operations
3. **HEAD hash** — saved for rollback
4. **WAL journal** — `.git/SkyFork-journal.json`, begin/complete/fail
5. **RecoveryManager** — startup checks: lock files, incomplete operations, rebase, merge

### Input Safety

- **Path traversal protection** — `safePath()` validates all IPC paths, preventing access outside the repository
- **Filename validation** — `isSafeFilename()` checks SSH key and git hook names for special characters
- **Safe clipboard** — `copyToClipboard()` wrapper with error handling for all clipboard operations
- **Electron sandbox** — `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- **Atomic writes** — writes via tmp+rename with fsync, Windows retry logic, crash-safe

### Cross-Platform

- `.gitattributes` for consistent line endings (LF for source, CRLF for .bat/.cmd)
- Cross-platform paths via `path.join()` / `path.resolve()` throughout the codebase
- Terminal: fallback chain for Linux (gnome-terminal, konsole, xfce4-terminal, xterm)
- `NUL` / `/dev/null` auto-selection per platform

---

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Prerequisites, setup, dev workflow, adding features |
| [Architecture](docs/architecture.md) | 4-layer design, data flow, core & renderer modules |
| [Features](docs/features.md) | What SkyFork can do: graph, diff, merge, blame, etc. |
| [Contributing](docs/contributing.md) | Code style, conventions, PR checklist |
| [Testing](docs/testing.md) | Vitest setup, test structure, manual feature testing |

Russian translations: [`docs/ru/`](docs/ru/)

Internal module docs: [`docs/internal/`](docs/internal/INDEX.md)

---

## Status

Version 0.1.0. Backend and UI feature-complete for MVP. 154 unit tests (Vitest). Not production-tested.

## License

MIT
