> Русская версия: [docs/ru/contributing.md](ru/contributing.md)

## Contributing to SkyFork

SkyFork is an Electron desktop Git client.

### How to Add a New Git Command

5 steps to add a command end-to-end:

1. **Define types** — Add the command type to `RendererCommand` in `src/core/bridge/messages.ts`. Add the response event type to `MainEvent`. Mirror both in `src/renderer/src/types/ipc.ts`.

2. **Implement git logic** — Add function in `src/core/commands/readCommands.ts` (for read operations) or `writeCommands.ts` (for write operations). Use `queue.enqueueRead()` or `queue.enqueueWrite()`.

3. **Wire to CommandHandler** — Add a method in `src/core/commands/CommandHandler.ts` that delegates to the function from step 2.

4. **Handle in MessageBridge** — Add a `case` in `src/core/bridge/MessageBridge.ts` `handleCommand()` switch. Call the CommandHandler method, send the response via `this.send()`.

5. **Call from renderer** — Use `postCommand({ type: 'yourCommand', ... })` from `src/renderer/src/api.ts`. Listen for response via `onMainEvent()` in your React component.

### How to Add a New UI Feature

1. Create a directory under `src/renderer/src/features/your-feature/`
2. Create the component `.tsx` and CSS Module `.module.css`
3. Create `index.ts` with exports
4. Import and wire into `src/renderer/src/App.tsx`
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
- **State**: Global state lives in `StateManager` (main). UI-only state in React `useState`
- **Error handling**: Git errors caught in `MessageBridge.handleCommand()`, sent as `{ type: 'error', message }` event

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
- [ ] No linter errors in changed files
- [ ] IPC types synced between core and renderer
- [ ] New features have corresponding IPC commands wired end-to-end
- [ ] Tested manually in Electron (not just browser)
