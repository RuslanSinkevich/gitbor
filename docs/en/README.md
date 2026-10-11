# GitBor

> Русская версия: [README.md](../../README.md)

A free cross-platform desktop Git client built on Electron for Windows, macOS and Linux. An alternative to Fork, GitKraken and SourceTree. Open source under the MIT license.

- Website: [gitbor.ru](https://gitbor.ru/en/)
- Documentation: [gitbor.ru/docs](https://gitbor.ru/docs/) (the [`docs/`](../) folder of this repository)
- Builds and updates: [GitHub Releases](https://github.com/RuslanSinkevich/gitbor/releases)
- Bugs and ideas: [GitHub Issues](https://github.com/RuslanSinkevich/gitbor/issues)

![GitBor — commit graph, branches, commit details and diff](../images/gitbor-screenshot.png)

---

## Quick start (development)

```bash
npm install
npm install --prefix src/renderer
npm run dev
```

`npm run dev` runs Vite (renderer on port 5188) and Electron (main process) via `concurrently`. You need Node.js 22+, npm 10+ and `git` in `PATH`.

```bash
npm run build          # renderer + main
npm start              # run the built app
npm test               # all unit tests (Vitest)
npm run lint           # ESLint
npm run e2e            # Playwright E2E (Windows)
npm run docs:counts    # refresh test counts in the docs
```

Installers: `npm run dist:win` / `dist:mac` / `dist:linux` (plus `:no-ai` variants). Releases for all platforms are built by GitHub Actions on a `vX.Y.Z` tag — see [Build and releases](BUILD.md).

---

## Stack

| Component | Technology |
|-----------|-----------|
| Desktop runtime | Electron 40 |
| UI | React 18, TypeScript 5.9, Vite 6 |
| Styles | CSS Modules, `--sg-*` CSS variables |
| File watching | chokidar 4 |
| Updates | electron-updater 6 (GitHub Releases), electron-builder 26 |
| Tests | Vitest 4 (<!-- TESTS_COUNT -->1116<!-- /TESTS_COUNT --> tests in <!-- TESTS_FILES -->95<!-- /TESTS_FILES --> files), Playwright 1.59 (E2E, Windows) |
| Quality | ESLint 10 (flat config), Prettier, husky 9 + lint-staged 17 |
| CI | GitHub Actions: `ci.yml`, `pr.yml`, `release.yml`, `release-pack.yml` |
| Git | System git from `PATH` (`execFile('git', …)` in `GitExecutor`) |

---

## Architecture

Four layers, dependencies only point down:

```
Renderer (React)  →  Preload (contextBridge)  →  Main (Node.js)  →  system git
```

```
App.tsx → api.invoke() → preload (ipcRenderer) → MessageBridge (ipcMain)
  → CommandHandler → GitExecutor → git
```

Every open repo has its own set of services (`GitExecutor`, `OperationQueue`, `SafetyNet`): a long `git pull` in one tab never blocks the others. Details — [Architecture](architecture.md).

---

## Project layout

```
gitbor/
├── src/
│   ├── core/              # Main process: all git work
│   │   ├── bridge/        # IPC: MessageBridge + handlers in ipc/handlers*.ts
│   │   ├── commands/      # CommandHandler, readCommands, writeCommands, ConflictManager
│   │   ├── git/           # GitExecutor, parsers, managers (rebase, bisect, hooks, LFS, worktrees), gitDir, stashRef
│   │   ├── safety/        # OperationQueue, SafetyNet, PreflightChecks, OperationJournal, RecoveryManager
│   │   ├── state/         # StateManager, RepoSlicesStore, RepoStateRefresher, FileWatcher, caches
│   │   ├── services/      # RepoServicesRegistry — services per repo
│   │   ├── ai/            # AI providers, prompts, settings store
│   │   ├── activity/      # Git activity log
│   │   ├── workers/       # WorkerPool for heavy parsers
│   │   ├── ssh/           # SSH keys
│   │   └── utils/         # Logger, AppError, pathSecurity, textEncoding, semver
│   ├── main/              # Electron entry point, AppUpdater, updateFlavor, releaseNotes
│   ├── preload/           # contextBridge → window.gitBorAPI
│   └── renderer/src/      # React UI
│       ├── features/      # graph, sidebar, changes, diff, merge, stash, rebase, … (one folder per feature)
│       ├── hooks/         # useAppState, useGraphFilter, useOperationToasts, …
│       ├── ui/            # UI kit: SgDialog, SgContextMenu, SgToast, …
│       └── i18n/          # ru / en
├── tests/                 # Vitest (unit + integration against real git)
├── tests-e2e/             # Playwright E2E
├── docs/                  # Documentation (Russian; English in docs/en)
├── build/                 # Build resources, release-notes.md
└── scripts/               # Icons, build flags, test counts
```

---

## Features

- **Commit graph** — virtualized, branch colors, search (Ctrl+F), author avatars, dimmed remote-only commits; refreshes by itself after commits made in a terminal, including branches like `feature/name/task`
- **Branch filter** — "Own commits" (first parent) or "Full history"; hide and pin branches
- **Compare** — commit with the working copy, two file versions, and two branches both ways ("what it brings into current" and "like a pull request")
- **Short context menus** for branches and commits; "Branches containing this commit", "Open in Azure DevOps / GitHub / GitLab", pull request link from a merge commit
- **Local changes** — file tree, stage / unstage / discard by file, folder, hunk and line
- **Diff** — inline / split, ignore whitespace, Markdown preview, correct Cyrillic in CP1251 / CP866 files
- **Stash** — includes new files, a clear message when there is nothing to stash
- **Merge conflicts** — two-column editor, conflict prediction
- **Interactive rebase**, cherry-pick (including several commits), revert, reset
- **File history, blame, reflog, bisect, hooks, worktrees, LFS, .gitignore, submodules**
- **Repository tabs** — an independent engine per repo, session restore
- **AI helpers** — commit message, explain commit / reflog / conflict, stash name, semantic search; local, corporate and cloud providers (a No AI build without them is available)
- **Data safety** — auto-stash, operation journal, crash recovery, clear actions on git errors
- **Auto-update** from GitHub Releases, with "what's new" right in the update dialog
- **Interface** — Russian and English, dark and light themes

Full list — [Features](features.md).

---

## Documentation

| Document | About |
|----------|-------|
| [Getting started](getting-started.md) | Setup, workflow, adding a command |
| [Architecture](architecture.md) | Layers, data flow, core and renderer modules |
| [Features](features.md) | What GitBor can do |
| [Safety and errors](safety-error-handling.md) | Git error classes, SafetyDialog, preflight, recovery |
| [Testing](testing.md) | Vitest, Playwright, writing tests |
| [Contributing](contributing.md) | Code style, commits, PR checklist |
| [Build and releases](BUILD.md) | Installers, GitHub Releases, auto-update, user data |
| [Cross-platform](cross-platform-checklist.md) | Open tasks for macOS / Linux / Windows |

---

## Status

Version 0.1.23. <!-- TESTS_COUNT -->1116<!-- /TESTS_COUNT --> unit tests in <!-- TESTS_FILES -->95<!-- /TESTS_FILES --> files plus Playwright E2E on Windows. Installers are not signed: Windows shows SmartScreen, macOS shows a Gatekeeper warning.

## License

[MIT](../../LICENSE)
