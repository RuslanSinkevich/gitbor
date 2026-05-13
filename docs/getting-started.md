> Русская версия: [docs/ru/getting-started.md](ru/getting-started.md)

# Getting Started (GitBor)

Developer guide for GitBor — an Electron-based desktop Git client (similar to Fork or GitKraken).

## Prerequisites

- Node.js 22+ (matches PR gate; CI matrix runs on Node 20)
- npm 10+
- `git` on your PATH

## Quick Start

```bash
cd gitbor
npm install
npm run dev
```

`npm run dev` uses `concurrently` to:

1. Start the Vite dev server on port **5188** (renderer).
2. Run TypeScript compiler (`tsc`) for the main process and launch Electron.

Vite serves the React renderer. `tsc` compiles main-process TypeScript into `dist/`. Electron loads the renderer from the Vite URL in development.

## Project Structure

| Path | Role |
|------|------|
| `src/core/` | Main-process backend: `git/`, `commands/`, `bridge/` (with `ipc/` submodules), `safety/`, `state/` (StateManager + RepoSlicesStore + RepoStateRefresher + RepoEventBus), `services/` (RepoServicesRegistry), `workers/` (parserWorker + WorkerPool), `activity/`, `ai/` (AiService + providers), `ssh/`, `utils/` (Logger, AppError, pathSecurity, repoPathGuard) |
| `src/main/` | Electron entry: `main.ts`, `i18n/` |
| `src/preload/` | `contextBridge` — `index.ts` |
| `src/renderer/` | React UI: `App.tsx`, `AppDialogs.tsx`, `features/` (graph / sidebar / changes / diff / merge / blame / file-history / rebase / repo-manager / repo-tabs / toolbar / titlebar / layout / ssh / settings / ai / reflog / bisect / hooks / worktrees / lfs / gitignore), `hooks/` (useAppState facade + useRepoSlices + useRunningOps + useStateSubscription + ...), `ui/`, `api.ts`, `types/`, `i18n/`, `styles/` |
| `tests/` | Tests (Vitest): `git/`, `commands/`, `state/`, `services/`, `activity/`, `safety/`, `bridge/`, `ai/`, `changes/`, `utils/`, `i18n/` |
| `docs/` | Documentation |
| `dist/` | Compiled output |

## Development Workflow

- **Main process:** After changing main-process code, rebuild with `npx tsc -p tsconfig.main.json` and restart Electron. Vite HMR does not reload the main process.
- **Renderer:** Edits under `src/renderer/` are picked up by Vite HMR without a full restart.
- **Full restart:** Stop anything bound to port 5188, rebuild if needed, then `npm run dev` again.

## Adding a New Feature (Step by Step)

Example: a new IPC-backed command end-to-end.

1. **Types** — Add or extend types in `src/core/git/types/` and mirror or consume them from `src/renderer/src/types/` as needed.
2. **IPC contract** — Add `RendererCommand` and `MainEvent` variants in `src/core/bridge/messages.ts` and align `src/renderer/src/types/ipc.ts`.
3. **Git / domain logic** — Implement in `src/core/commands/readCommands.ts` or `writeCommands.ts` (or the appropriate command module). Take services per-call from `state.getActiveServices()` — no class fields tied to a single repo.
4. **Handler** — Expose a method on `src/core/commands/CommandHandler.ts` that runs the new logic.
5. **Bridge** — Add the handler to one of the `src/core/bridge/ipc/handlers*.ts` files (state, gitOps, repoExtras, ai). Use `op` / `opWithPostMerge` from `helpers.ts` so `repoPath` is snapshotted before the operation starts (a tab switch between events must not break the per-repo running flag).
6. **Renderer API** — Invoke from the UI with `postCommand()` in `src/renderer/src/api.ts`.
7. **UI** — Subscribe with `onMainEvent()` in a React component (or hook) to handle responses and updates. For per-repo operations, route the event by `repoPath` so it lands on the correct slice.

### Adding an AI Provider

If you need to plug in another AI backend:

1. Implement `AiProvider` (`src/core/ai/providers/base.ts`) — `testConnection` and `complete(options)` with SSE streaming via `onChunk`.
2. Add the new mode to `AiConnectionMode` in `src/core/ai/types.ts`.
3. Branch in `AiService.ensureProvider()` to instantiate it.
4. Add a preset in `src/renderer/src/features/ai/presets.ts` and a label key in both `en.ts` and `ru.ts`.
5. Wire secret persistence in `AiConfigStore` (encrypt via `safeStorage`, fall back to `plain:`).

## Build

```bash
npm run build   # Renderer + main
npm start       # Run the packaged output
```

## Troubleshooting

| Issue | What to do |
|-------|------------|
| Port 5188 in use | Kill the process using the port or set `VITE_DEV_PORT` to another value. |
| TypeScript errors in main | Check `tsconfig.main.json` and paths; fix types before relying on `dist/`. |
| HMR not updating UI | Reload the Electron window (e.g. **Ctrl+R**). |
| Main changes seem ignored | Rebuild with `tsc` for the main config and restart Electron. |
