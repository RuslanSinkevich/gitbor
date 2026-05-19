> Русская версия: [docs/ru/contributing.md](ru/contributing.md)

## Contributing to GitBor

GitBor is an Electron desktop Git client.

### How to Add a New Git Command

5 steps to add a command end-to-end:

1. **Define types** — Add the command type to `RendererCommand` in `src/core/bridge/messages.ts`. Add the response event type to `MainEvent`. Mirror both in `src/renderer/src/types/ipc.ts`.

2. **Implement git logic** — Add function in `src/core/commands/readCommands.ts` (for read operations) or `writeCommands.ts` (for write operations). Use `queue.enqueueRead()` or `queue.enqueueWrite()`. Take services per-call from `state.getActiveServices()` — the registry is per-repo, never cache `git`/`queue`/`safety` in class fields.

3. **Wire to CommandHandler** — Add a method in `src/core/commands/CommandHandler.ts` that delegates to the function from step 2.

4. **Add an IPC handler** — Add an entry to one of the handler tables in `src/core/bridge/ipc/handlers*.ts` (`handlersState.ts`, `handlersGitOps.ts`, `handlersRepoExtras.ts`, `handlersAi.ts`). Use `op` / `opWithPostMerge` from `helpers.ts` so `repoPath` is snapshotted **before** the operation starts — a tab switch between `operationStart` and `operationEnd` must not break the per-repo running flag.

5. **Call from renderer** — Use `postCommand({ type: 'yourCommand', ... })` from `src/renderer/src/api.ts`. Listen for response via `onMainEvent()` in your React component or hook. Route by `repoPath` if the event is per-repo so it lands on the correct slice.

### How to Add a New UI Feature

1. Create a directory under `src/renderer/src/features/your-feature/`
2. Create the component `.tsx` and CSS Module `.module.css`
3. Create `index.ts` with exports
4. Import and wire into `src/renderer/src/App.tsx` (for dialogs, use `src/renderer/src/AppDialogs.tsx`)
5. If it needs IPC — follow the "Add a New Git Command" steps above

### Code Style

- TypeScript with strict mode
- CSS Modules with `--sg-*` CSS custom properties for theming
- No comments explaining obvious code — comments only for non-obvious intent
- File naming: PascalCase for components (`CommitGraph.tsx`), camelCase for utilities (`branchPaths.ts`)
- One component per file

### Project Conventions

- **Imports**: React hooks first, then local modules, then types, then styles
- **IPC types**: Always keep `src/core/bridge/messages.ts` and `src/renderer/src/types/ipc.ts` in sync
- **State**: Global state lives in `StateManager` (main, per-repo via `RepoSlicesStore`). UI-only state in React `useState`. Per-repo running ops live in `useRunningOps` — `state.isOperationRunning` is derived from the active tab only.
- **Error handling**: Throw `AppError(code, data, fallback)` in main for translatable errors — `MessageBridge` will turn it into an `error`-event with `code`/`data` and the renderer translates via `locale.repoErrors[code]`. Plain `throw new Error('...')` is fine only for technical errors that don't need i18n.
- **Logging**: Use `mainLogger` from `src/core/utils/Logger.ts` — never raw `console.warn/error` in core (the only exception is `process.on('unhandledRejection'/'uncaughtException')`, which must work before `configureMainLogger`).
- **Path safety**: Validate all user-provided IPC paths with `safePath()` from `src/core/utils/pathSecurity.ts`; filenames with `isSafeFilename()`. Use `isDangerousRepoRoot()` before starting a recursive watcher.
- **Sensitive args**: Pass them via `env` or stdin where possible; if they end up in argv, ensure `sanitizeArgs` redacts them in logs.
- **Clipboard**: Use `copyToClipboard()` from `src/renderer/src/api.ts` instead of raw `navigator.clipboard.writeText`
- **Timers**: Always clean up `setTimeout` in React components via `clearTimeout` in `useEffect` cleanup or `useRef`
- **Dialogs**: Add new dialogs via `useDialogs` hook (`src/renderer/src/hooks/useDialogs.ts`) and render them from `AppDialogs.tsx`
- **AI secrets**: Never log API keys / Qwen tokens. Persist via `AiConfigStore` (encrypted by `safeStorage`); mask in any UI-bound payload (`••••••••`).

### Branch Naming
- `feat/description` — new features
- `fix/description` — bug fixes
- `refactor/description` — code restructuring
- `docs/description` — documentation

### Commit Messages
- Short imperative: "add merge editor", "fix diff for untracked files"
- No prefixes like "feat:" unless the team adopts conventional commits

### PR Checklist
- [ ] TypeScript compiles without errors (`npx tsc -p tsconfig.main.json`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Formatting is consistent (`npm run format`)
- [ ] IPC types synced between core and renderer
- [ ] New features have corresponding IPC commands wired end-to-end
- [ ] Unit tests pass (`npm test` — Vitest, <!-- TESTS_COUNT -->635<!-- /TESTS_COUNT --> in <!-- TESTS_FILES -->58<!-- /TESTS_FILES --> files; auto-run in `.husky/pre-push`, bypass with `SKIP_TESTS=1`)
- [ ] E2E tests pass on Windows (`npm run e2e` — Playwright, 3 specs, ~27s)
- [ ] User-provided paths validated via `safePath()` / `isSafeFilename()`
- [ ] New i18n keys added to both languages (en + ru)
- [ ] Tested manually in Electron (not just browser)
- [ ] `pr.yml` workflow green (lint / tsc / test / build / e2e on Windows + Node 22)
- [ ] `ci.yml` workflow green after merge (3 OS matrix on Node 20)
