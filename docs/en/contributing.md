> Русская версия: [docs/contributing.md](../contributing.md)

# Contributing to GitBor

GitBor is a desktop Git client built on Electron. Bugs and ideas — [GitHub Issues](https://github.com/RuslanSinkevich/gitbor/issues).

### Adding a Git command

1. **Types and contract** — a variant in `RendererCommand` (and `MainEvent` if the reply is an event) in `src/core/bridge/messages.ts`. The renderer gets types via the re-export in `src/renderer/src/types/index.ts`.
2. **Git logic** — a function in `src/core/commands/readCommands.ts` (reads) or `writeCommands.ts` (writes) via `queue.enqueueRead()` / `enqueueWrite()`. Services (`git` / `queue` / `safety`) belong to a repo — never cache them in class fields.
3. **CommandHandler** — a method in `src/core/commands/CommandHandler.ts`.
4. **IPC handler** — an entry in one of the `src/core/bridge/ipc/handlers*.ts` tables. For operations use `op` / `opWithPostMerge` from `helpers.ts` so `repoPath` is captured before the start.
5. **Renderer** — `postCommand()` or `invokeCommand()` from `src/renderer/src/api.ts`; events via `onMainEvent()`, routed by `repoPath`.

More detail with examples — [Getting started](getting-started.md).

### Adding a UI feature

1. A folder `src/renderer/src/features/<feature>/`.
2. A `.tsx` component and, if needed, a CSS Module.
3. An `index.ts` with exports.
4. Wire it up in `App.tsx` (dialogs — in `AppDialogs.tsx` via `useDialogs`).
5. Texts in `src/renderer/src/i18n/ru.ts` and `en.ts` (completeness is checked by `tests/i18n/i18n.test.ts`).

### Code style

- TypeScript in strict mode.
- CSS Modules and `--sg-*` variables for themes.
- Comments only for the non-obvious "why", never a retelling of the code.
- File names: PascalCase for components (`CommitGraph.tsx`), camelCase for utilities (`branchPaths.ts`).

### Project conventions

- **State** — global state lives in `StateManager` (main, per repo via `RepoSlicesStore`); UI-only state in `useState`. `state.isOperationRunning` comes from the active tab.
- **Errors** — throw translatable errors as `AppError(code, data, fallback)`; the renderer translates via `locale.repoErrors[code]`. Git errors are classified by `GitErrorClassifier` from English stderr — `GitExecutor` always runs git with `LC_MESSAGES=C`.
- **Logging** — `mainLogger` from `src/core/utils/Logger.ts`, no raw `console.*` in core.
- **Paths** — user paths through `safePath()`, file names through `isSafeFilename()`; the `.git` directory only via `resolveGitDir()` / `resolveCommonGitDir()` (`src/core/git/gitDir.ts`): in worktrees and submodules `.git` is a file, not a folder.
- **`exec` does not throw on a non-zero exit code** — check `exitCode` yourself, otherwise a git failure looks like success.
- **Sensitive arguments** — via `env` or stdin; if they end up in argv, `sanitizeArgs` must redact them.
- **Clipboard** — `copyToClipboard()` from `api.ts`.
- **Timers** — clear them in the `useEffect` cleanup.
- **AI secrets** — never log them; store via `AiConfigStore`, send masked to the UI.

### Branches and commits

- Branches: `feat/…`, `fix/…`, `refactor/…`, `docs/…`.
- Commits follow conventional commits with a scope; the project writes descriptions in Russian: `feat(graph): лаконичное меню коммита`, `fix(watcher): …`, `docs: …`, `chore(release): 0.1.23`. The body explains what and why when the subject is not enough.

### PR checklist

- [ ] `npx tsc -p tsconfig.main.json` and `npx tsc --noEmit` in `src/renderer` have no errors
- [ ] `npm run lint` passes
- [ ] `npm test` passes (currently <!-- TESTS_COUNT -->1116<!-- /TESTS_COUNT --> tests in <!-- TESTS_FILES -->95<!-- /TESTS_FILES --> files; after adding tests run `npm run docs:counts`)
- [ ] `npm run e2e` passes on Windows
- [ ] New texts exist in both `ru.ts` and `en.ts`
- [ ] User paths go through `safePath()` / `isSafeFilename()`
- [ ] Checked by hand in Electron, not only in tests
- [ ] `pr.yml` is green (lint / tsc / test / build / e2e on Windows)
