> Русская версия: [docs/getting-started.md](../getting-started.md)

# Getting started (GitBor)

A guide for developers of GitBor, a desktop Git client built on Electron.

## Requirements

- Node.js 22+ (used by the PR gate and the release builds; the CI matrix also checks Node 20)
- npm 10+
- `git` in `PATH`

## Quick start

```bash
npm install
npm install --prefix src/renderer
npm run dev
```

`npm run dev` uses `concurrently` to:

1. Start the Vite dev server on port **5188** (renderer).
2. Build the main process (`tsc -p tsconfig.main.json`) and launch Electron once Vite is ready.

In development Electron loads the renderer from the Vite URL and the main process from `dist/main/`.

## Project layout

| Path | Purpose |
|------|---------|
| `src/core/` | Main process: `git/` (GitExecutor, parsers, managers, `gitDir.ts`, `stashRef.ts`), `commands/`, `bridge/` (MessageBridge + `ipc/handlers*.ts`), `safety/`, `state/` (StateManager, RepoSlicesStore, RepoStateRefresher, RepoEventBus, FileWatcher), `services/` (RepoServicesRegistry), `workers/`, `activity/`, `ai/`, `ssh/`, `errors/`, `repoSummary/`, `utils/` |
| `src/main/` | Electron entry point: `main.ts`, auto-update (`AppUpdater.ts`, `updateFlavor.ts`, `releaseNotes.ts`), `gracefulShutdown.ts`, `cspOrigins.ts` |
| `src/preload/` | `contextBridge` — `index.ts` |
| `src/renderer/src/` | React UI: `App.tsx`, `AppDialogs.tsx`, `api.ts`, `features/` (one folder per feature: graph, sidebar, changes, diff, merge, stash, checkout, rebase, reflog, bisect, blame, file-history, repo-manager, repo-tabs, toolbar, titlebar, layout, settings, ssh, ai, safety, statistics, worktrees, lfs, hooks, gitignore, git-activity, support, app-shell), `hooks/`, `ui/`, `i18n/`, `styles/`, `types/` |
| `tests/` | Vitest: unit tests and integration tests against real git (one folder per layer) |
| `tests-e2e/` | Playwright E2E (Windows) |
| `docs/` | Documentation (Russian; English in `docs/en/`) |
| `build/` | Build resources: icons, NSIS script, `release-notes.md` |
| `scripts/` | Icons, build flags, `update-test-counts.mjs` |

## Workflow

- **Main process.** After changes rebuild with `npx tsc -p tsconfig.main.json` and restart Electron — Vite HMR does not reload main.
- **Renderer.** Changes in `src/renderer/` are picked up by Vite HMR without a restart.
- **Pre-commit checks.** The pre-commit hook runs `eslint --fix` and `tsc --noEmit` for main and renderer; pre-push runs `npm test` (skip with `SKIP_TESTS=1`).

## Adding a command (IPC end to end)

1. **Types** — extend the types in `src/core/git/types/`. The renderer gets them via the re-export in `src/renderer/src/types/index.ts`; no need to duplicate.
2. **IPC contract** — add a variant to `RendererCommand` (and to `MainEvent` if the reply is an event) in `src/core/bridge/messages.ts`.
3. **Git logic** — a function in `src/core/commands/readCommands.ts` (reads) or `writeCommands.ts` (writes) via `queue.enqueueRead()` / `enqueueWrite()`.
4. **CommandHandler** — a method in `src/core/commands/CommandHandler.ts` that calls it.
5. **Handler** — an entry in the right table in `src/core/bridge/ipc/handlers*.ts` (`State`, `GitOps`, `RepoExtras`, `Safety`, `Shell`, `Ai`, `AppUpdate`). For operations use `op` / `opWithPostMerge` from `helpers.ts`: they capture `repoPath` before the start, so switching tabs mid-operation breaks nothing. If the reply should be a return value (not an event), just return it from the handler.
6. **Renderer** — `postCommand()` (reply as an event) or `invokeCommand()` (return value) from `src/renderer/src/api.ts`; listen to event replies with `onMainEvent()`.
7. **Read-only?** Add the command type to `NON_RETRYABLE_TYPES` in `api.ts` so the toast's "Retry" button never re-runs it instead of the real operation.

### Adding an AI provider

1. Implement `AiProvider` (`src/core/ai/providers/base.ts`): `testConnection` and `complete(options)` streaming via `onChunk`.
2. Add a mode to `AiConnectionMode` (`src/core/ai/types.ts`) and a branch in `AiService.ensureProvider()`.
3. Add a preset to `src/renderer/src/features/ai/presets.ts` and labels to `en.ts` / `ru.ts`.
4. Store secrets via `AiConfigStore` (`safeStorage` encryption, `plain:` fallback prefix).

## Build

```bash
npm run build   # renderer + main
npm start       # run the built app
```

Installers, GitHub releases, auto-update and user data paths — see [BUILD.md](BUILD.md).

## Troubleshooting

| Problem | What to do |
|---------|------------|
| Port 5188 in use | Stop the process on the port or set another `VITE_DEV_PORT`. |
| TypeScript errors in main | Check `tsconfig.main.json` and paths; fix types before running. |
| HMR does not update the UI | Reload the Electron window (**Ctrl+R**). |
| Main changes are not visible | Rebuild with `npx tsc -p tsconfig.main.json` and restart Electron. |
| `npm ci` fails with ERESOLVE | The repo has an `.npmrc` with `legacy-peer-deps` — run from the project root. |
