> Русская версия: [docs/ru/getting-started.md](ru/getting-started.md)

# Getting Started (SkyFork)

Developer guide for SkyFork — an Electron-based desktop Git client (similar to Fork or GitKraken).

## Prerequisites

- Node.js 18+
- npm
- `git` on your PATH

## Quick Start

```bash
cd skyfork
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
| `src/core/` | Main-process backend: `git/`, `commands/`, `bridge/`, `safety/`, `state/`, `ssh/`, `utils/` |
| `src/main/` | Electron entry: `main.ts`, `menu.ts`, `i18n/` |
| `src/preload/` | `contextBridge` — `index.ts` |
| `src/renderer/` | React UI: `features/`, `hooks/`, `ui/`, `api.ts`, `types/`, `i18n/`, `styles/` |
| `tests/` | Tests (Vitest): `git/`, `safety/`, `bridge/`, `i18n/` |
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
3. **Git / domain logic** — Implement in `src/core/commands/readCommands.ts` or `writeCommands.ts` (or the appropriate command module).
4. **Handler** — Expose a method on `src/core/commands/CommandHandler.ts` that runs the new logic.
5. **Bridge** — Route the command and events in `src/core/bridge/MessageBridge.ts`.
6. **Renderer API** — Invoke from the UI with `postCommand()` in `src/renderer/src/api.ts`.
7. **UI** — Subscribe with `onMainEvent()` in a React component (or hook) to handle responses and updates.

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
