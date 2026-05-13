> Русская версия: [docs/ru/testing.md](ru/testing.md)

# Testing GitBor

## Stack

| Component | Version |
|-----------|---------|
| Framework | [Vitest](https://vitest.dev/) 4.x |
| Config | `vitest.config.ts` (project root) |
| Tests | `tests/**/*.test.ts` |
| Environment | Node.js (no DOM) |

---

## Quick Start

```bash
# Install dependencies (if not done yet)
npm install

# Run all tests
npm test

# Same thing directly
npx vitest run

# Watch mode (re-runs on file changes)
npx vitest

# Run a specific file
npx vitest run tests/git/GitParser.test.ts

# Run by name pattern
npx vitest run --reporter=verbose GitParser
```

---

## Test Structure

```
tests/
├── git/                          # Git parsers & managers
│   ├── GitParser.test.ts         # Commits, branches, tags, stash, remotes, status
│   ├── DiffParser.test.ts        # Unified diff parsing
│   ├── ConflictParser.test.ts    # Conflict markers (<<<<<<< / >>>>>>>)
│   ├── ReflogParser.test.ts      # git reflog output
│   ├── BlameParser.test.ts       # git blame output
│   ├── SubmoduleParser.test.ts   # Submodule status & .gitmodules
│   ├── FileHistoryParser.test.ts # File history entries
│   ├── GraphLayout.test.ts       # Commit graph layout algorithm
│   ├── BisectManager.test.ts     # BisectStatus interface contract
│   ├── HooksManager.test.ts      # HookInfo interface contract
│   ├── LfsManager.test.ts        # LfsStatus interface contract
│   ├── WorktreeManager.test.ts   # Worktree list/add/remove with mocked GitExecutor
│   ├── GitExecutor.test.ts       # sanitizeArgs redaction logic
│   └── RebaseManager.test.ts     # Interactive rebase: todo parsing, GIT_SEQUENCE_EDITOR
│
├── commands/
│   ├── writeCommands.test.ts     # stageFile (--), commit, push, initRepo, checkout, clone
│   ├── readCommands.test.ts      # log, status, branches, tags, stashes, remotes
│   └── ConflictManager.test.ts   # completeMerge, resolveWithOurs/Theirs, merge, predictConflicts
│
├── state/
│   ├── StateManager.test.ts      # Multi-repo snapshots, tokens, listeners, isRepoTracked guard
│   └── repoSlice.test.ts         # emptyRepoSlice, mirrorRepoSliceToAppState, hashGitStdout, GIT_*_FORMAT
│
├── services/
│   └── RepoServicesRegistry.test.ts # Per-repo lifecycle: acquire/release, kill, isolation A↔B
│
├── activity/
│   └── GitActivityStore.test.ts  # start/append/finish, per-repo, cap=100, stdout/stderr truncation
│
├── utils/
│   ├── pathSecurity.test.ts      # safePath traversal, isSafeFilename validation
│   ├── repoPathGuard.test.ts     # isDangerousRepoRoot (home/Windows/Program Files/...)
│   ├── AppError.test.ts          # AppError code/data/fallback, instanceof Error
│   └── Logger.test.ts            # Levels (silent/error/warn/info/debug), stdout/stderr split, configureMainLogger
│
├── safety/
│   ├── OperationQueue.test.ts    # Operation queue (read/write, serialization, errors)
│   ├── AtomicWrite.test.ts       # Atomic file writes (sync + async)
│   └── OperationJournal.test.ts  # WAL journal (lifecycle, cleanup, concurrency)
│
├── bridge/
│   ├── messages.test.ts          # IPC contracts (RendererCommand, MainEvent)
│   └── helpers.test.ts           # ipc/helpers: op/opWithPostMerge repoPath snapshot, errOnFail, runTracked
│
├── ai/
│   ├── AiConfigStore.test.ts     # Provider config, encryption via safeStorage, qwen-web persistence
│   ├── AiHandlers.test.ts        # AI IPC handlers (mask secrets, mergeSecrets, cancel)
│   ├── AiService.test.ts         # generateCommitMessage, testConnection
│   ├── OpenAiCompatibleProvider.test.ts # SSE parser, finishReason, usage
│   ├── QwenWebProvider.test.ts   # constructor, testConnection, SSE stream, RateLimited, abort, fallback model
│   ├── presets.test.ts           # detectPreset (openai-compatible, qwen-web, trailing-slash normalization)
│   └── prompts.test.ts           # buildCommitSystemPrompt (auto/en/ru) / buildCommitUserPrompt
│
├── changes/
│   └── fileTree.test.ts          # buildFileTree / collectFiles (pure helpers from fileTreeModel.ts)
│
└── i18n/
    ├── i18n.test.ts              # Localization completeness (en ↔ ru keys, placeholders)
    └── tpl.test.ts               # Template interpolator {key}
```

---

## What Is Tested

### 1. GitParser (`tests/git/GitParser.test.ts`)

Module: `src/core/git/GitParser.ts`

| Function | Scenarios |
|----------|-----------|
| `parseRefs` | HEAD → branch, bare HEAD, tag, remote, local branch, multiple refs |
| `parseCommits` | Single commit, GPG status G/N, multiple parents, root commit, empty input, insufficient fields |
| `parseBranches` | Local branches, remote branches, current branch (`*`), missing upstream |
| `parseTags` | Normal tags, empty, skipping nameless entries |
| `parseStashes` | Stash entries with index/hash/message |
| `parseRemotes` | fetch/push URLs, multiple remotes |
| `parseStatus` | Staged/unstaged modifications, `MM` (both), untracked (`??`), staged add (`A`), delete (`D`), conflicts (`UU`, `AA`), multiple files |
| `parseFileChanges` | Modification, addition, deletion, rename (`R100`), copy (`C100`) |

### 2. DiffParser (`tests/git/DiffParser.test.ts`)

Module: `src/core/git/DiffParser.ts`

- Simple modification (context + remove + add lines)
- New file (`/dev/null` → `b/file`)
- Deleted file (`a/file` → `/dev/null`)
- Rename (`rename from`/`rename to`)
- Binary files (`Binary files`)
- Multiple files in one diff
- Multiple hunks (`@@ ... @@`)
- Correct line numbers per hunk

### 3. ConflictParser (`tests/git/ConflictParser.test.ts`)

Module: `src/core/git/ConflictParser.ts`

- Single conflict (`<<<<<<< / ======= / >>>>>>>`)
- Multiple conflicts in one file
- diff3 format (3 sections: ours / base / theirs)
- Empty sides
- Incomplete markers (graceful — no crash)
- Conflict not at start of file

### 4. ReflogParser (`tests/git/ReflogParser.test.ts`)

Module: `src/core/git/ReflogParser.ts`

- `reflogArgs()` — correct git arguments with `--format` and `-n`
- `parseReflog()` — checkout, commit, messages with/without colon
- Multiple entries
- Index extraction from `HEAD@{N}`
- Empty/invalid input

### 5. BlameParser (`tests/git/BlameParser.test.ts`)

Module: `src/core/git/BlameParser.ts`

- Empty input
- Single blame block (hash, author, date, line content)
- Multiple lines
- Empty content lines

### 6. SubmoduleParser (`tests/git/SubmoduleParser.test.ts`)

Module: `src/core/git/SubmoduleParser.ts`

**`parseSubmoduleStatus`:** clean (` `), modified (`+`), uninitialized (`-`), conflict (`U`), multiple submodules.

**`parseGitmodules`:** empty input, path+URL pairs, multiple submodules, orphan entries without URL.

### 7. FileHistoryParser (`tests/git/FileHistoryParser.test.ts`)

Module: `src/core/git/FileHistoryParser.ts`

- Empty input
- Single entry (hash, shortHash, subject, authorName, authorDate, status)
- Multiple entries (separated by `\n\n`)
- Default status `M` when missing

### 8. GraphLayout (`tests/git/GraphLayout.test.ts`)

Module: `src/core/git/GraphLayout.ts`

- Empty commit array
- Linear chain (all nodes in column 0)
- Simple branch and merge
- Unique colors per column
- Unknown parent handling (no crash)

### 9. WorktreeManager (`tests/git/WorktreeManager.test.ts`)

Module: `src/core/git/WorktreeManager.ts`

- `list()` — parses porcelain output (main, linked, detached, bare worktrees)
- `add()` — calls `git worktree add` with branch
- `remove()` — calls `git worktree remove`

### 9a. GitExecutor (`tests/git/GitExecutor.test.ts`)

Module: `src/core/git/GitExecutor.ts`

- `sanitizeArgs` redacts values after `-m`, `-C`, `-N` flags
- Preserves non-sensitive arguments
- Handles edge cases (flag at end, multiple sensitive flags)

### 9b. RebaseManager (`tests/git/RebaseManager.test.ts`)

Module: `src/core/git/RebaseManager.ts`

- `getTodoList` — parses log output, handles empty
- `executeRebase` — sets `GIT_SEQUENCE_EDITOR` with `cp`, filters dropped entries
- `continueRebase`, `abortRebase` — correct git arguments

### 9c. writeCommands (`tests/commands/writeCommands.test.ts`)

Module: `src/core/commands/writeCommands.ts`

- `stageFile` — uses `--` separator, handles filenames starting with `-`
- `stageAll`, `unstageFile` — correct arguments
- `commit` — message, amend, failure handling
- `initRepo` — uses parent dir as cwd
- `push` — force, upstream options
- `checkout`, `discardFileChanges`, `cloneRepo`

### 9d. ConflictManager (`tests/commands/ConflictManager.test.ts`)

Module: `src/core/commands/ConflictManager.ts`

- `completeMerge` — checks commit exitCode, handles unresolved conflicts
- `resolveWithOurs` / `resolveWithTheirs` — uses `--` before paths
- `merge` — clean merge, options passing
- `predictConflicts` — error handling

### 9e. pathSecurity (`tests/utils/pathSecurity.test.ts`)

Module: `src/core/utils/pathSecurity.ts`

- `safePath` — normal paths, traversal attempts, absolute paths, nested, filenames with `..`
- `isSafeFilename` — safe names, separators, `..`, special chars, empty

### 10. OperationQueue (`tests/safety/OperationQueue.test.ts`)

Module: `src/core/safety/OperationQueue.ts`

- Initial state (no write running, empty queue)
- Read/write execution
- Write serialization (strict ordering)
- Parallel reads (start simultaneously)
- Status listener notifications
- Listener unsubscription
- Error propagation
- Queue recovery after error

### 11. i18n Completeness (`tests/i18n/i18n.test.ts`)

Modules: `src/renderer/src/i18n/en.ts`, `src/renderer/src/i18n/ru.ts`

- Same key count en ↔ ru
- Every en key exists in ru
- Every ru key exists in en
- No empty strings in en
- No empty strings in ru
- Template placeholders `{name}` match between languages
- All top-level sections present in both languages

### 12. Template Interpolator (`tests/i18n/tpl.test.ts`)

- Single placeholder `{name}`
- Multiple placeholders
- Numeric values
- Missing keys (stay as `{key}`)
- No placeholders (returned as-is)
- Repeated placeholders
- Empty template

### 13. RepoServicesRegistry (`tests/services/RepoServicesRegistry.test.ts`)

Module: `src/core/services/RepoServicesRegistry.ts`

- `acquire(repoPath)` is idempotent (same call returns the same services object)
- `acquire` for different paths yields different `git`/`queue`/`safety`
- `bootstrap()` is a singleton (used for clone/init without an open repo)
- `release(repoPath)` calls `git.killAll()` and removes from the map; second `release` is a no-op
- `disposeAll()` cleans repo services, bootstrap, and listeners
- `onAnyOperationStatusChange` fires for per-repo queue write events
- **Isolation**: a long write on repo A does not block a write on repo B (the key invariant)

### 14. repoSlice (`tests/state/repoSlice.test.ts`)

Module: `src/core/state/repoSlice.ts`

- `emptyRepoSlice()` returns a fresh object (arrays not shared between calls)
- `mirrorRepoSliceToAppState` copies repo-specific fields and does NOT touch meta (`openRepos`/`activeRepoIndex`/running flags)
- `hashGitStdout` is deterministic, different inputs produce different md5
- Contracts of `GIT_LOG_FORMAT` (8 NUL fields), `GIT_REF_FORMAT` (4), `GIT_TAG_REF_FORMAT` (2), `GIT_STASH_FORMAT` (`%gd`/`%gs`)

### 15. AppError (`tests/utils/AppError.test.ts`)

Module: `src/core/utils/AppError.ts`

- `code` and `data` are preserved for IPC propagation
- `fallback` becomes `message`, otherwise `message = code`
- `data` defaults to an empty object
- Inherits `Error` → catchable in `try/catch`, `name === 'AppError'`

### 16. GitActivityStore (`tests/activity/GitActivityStore.test.ts`)

Module: `src/core/activity/GitActivityStore.ts`

- `start(operation, repoPath)` creates a running entry with `repoPath` (the renderer filters by it)
- `appendCommand` on an unknown id is a no-op (does not throw)
- `finish` sets `success`/`error` status and `finishedAt`
- `clear` emits a `cleared` event; `subscribe` returns an unsubscribe
- Newest first (unshift), cap of 100 entries
- Truncates stdout/stderr > 16 KiB to OUTPUT_CAP_BYTES with a `[truncated...]` marker

### 17. ipc/helpers (`tests/bridge/helpers.test.ts`)

Module: `src/core/bridge/ipc/helpers.ts`

- **Key invariant**: `op` snapshots `repoPath` BEFORE starting the operation; switching tabs between `operationStart` and `operationEnd` does not change `repoPath` in the end event (this fixes "the other tab gets stuck waiting")
- `op` propagates `error` from the result into the end event
- `op` works correctly with empty `repoPath` (clone before `openRepo`)
- `opWithPostMerge` sends `mergeState` after `operationEnd`
- `errOnFail` only emits `error` when `success = false`
- `mergeStateAfter` always emits `mergeState`
- `runTracked` writes to `gitActivityStore` (start + finish), including `error` on throw

### 18. Logger (`tests/utils/Logger.test.ts`)

Module: `src/core/utils/Logger.ts`

- Levels `silent`/`error`/`warn`/`info`/`debug` correctly filter messages
- ERROR/WARN go to `console.error` (stderr), DEBUG/INFO to `console.log` (stdout)
- Prefix + time + tag (`[T] HH:MM:SS WARN: msg`)
- `configureMainLogger({ isProduction: true })` → `silent` (silent in prod)
- `configureMainLogger({ isProduction: false })` → `debug` (everything visible in dev)
- ENV `GITBOR_LOG_LEVEL=warn` overrides the default
- Invalid `GITBOR_LOG_LEVEL` is ignored (falls back to `isProduction`)

### 19. repoPathGuard (`tests/utils/repoPathGuard.test.ts`)

Module: `src/core/utils/repoPathGuard.ts`

- Empty/non-string path → `dangerous: true`
- Current user home directory, drive root (`C:\`, `/`), `\Users` root → `dangerous`
- Windows system roots: `C:\Windows`, `C:\Program Files`, `C:\ProgramData`
- POSIX system roots: `/etc`, `/usr`, `/var`, `/home`, `/Users`
- Normal project paths → `dangerous: false`

### 20. AI providers and presets

**`tests/ai/AiConfigStore.test.ts`** — `src/core/ai/AiConfigStore.ts`:

- Persists OpenAI-compatible config; encrypts `apiKey` via injected `CryptoProvider` (mock for `safeStorage`)
- Persists Qwen Web config: stores `qwenWebTokenEncrypted`, restores `mode: 'qwen-web'`, baseUrl forced to `https://chat.qwen.ai`
- Falls back to `plain:` prefix when `isEncryptionAvailable()` returns false (or `encryptString` throws)
- `clear()` writes an empty entry, doesn't delete the file
- `commitLanguage` round-trips through `auto`/`en`/`ru`; invalid values normalize to `auto`

**`tests/ai/AiHandlers.test.ts`** — `src/core/ai/AiHandlers.ts`:

- `getConfig` masks `apiKey` and `qwenWebToken` (returns `••••••••`) so the renderer never sees the real value
- `setConfig` with a masked key from the UI keeps the previous secret (`mergeSecrets`)
- `setConfig(null)` clears both the in-memory service and the on-disk store
- `generateCommitMessage` routes `requestId → AbortController`; `cancel(requestId)` aborts the right one; `cancelAll()` aborts everything
- Empty model response with `finish_reason: 'length'` throws a friendly `AiError('parse')` mentioning `max_tokens`

**`tests/ai/AiService.test.ts`** — `src/core/ai/AiService.ts`:

- `isConfigured` returns false for missing model; for `qwen-web` requires `qwenWebToken`; for `openai-compatible` requires `baseUrl`
- `generateCommitMessage` builds prompts via `commitLanguage`, post-processes the response (strips ```` ``` ```` and surrounding quotes)

**`tests/ai/OpenAiCompatibleProvider.test.ts`** — `src/core/ai/providers/OpenAiCompatibleProvider.ts`:

- SSE parsing across chunk boundaries, `[DONE]` termination, `usage` and `finish_reason` mapping
- HTTP errors carry `status` in `AiError`; abort propagates through `signal`

**`tests/ai/QwenWebProvider.test.ts`** — `src/core/ai/providers/QwenWebProvider.ts`:

- Constructor rejects wrong mode, missing token, missing model
- `testConnection` calls `POST /api/v2/chats/new` with `Bearer` token and times out after 10s
- Streaming flow: create chat → SSE chat completions; emits `onChunk` for `delta.content`
- `code: 'RateLimited'` in payload becomes `AiError('http', 429)`
- Empty stream (likely expired token) becomes `AiError('parse')` with a hint to refresh the token in `chat.qwen.ai → localStorage.token`
- Unknown model id falls back to `qwen3-max` (the whitelist in `qwenWebModels.ts`)
- External `signal.abort()` cancels the inflight `fetch`

**`tests/ai/presets.test.ts`** — `src/renderer/src/features/ai/presets.ts`:

- `detectPreset('openai-compatible', baseUrl, model)` matches presets normalized for trailing slashes
- `detectPreset('qwen-web', _, model)` returns `qwen-web` only when `model` matches the preset's default; else `custom`
- Unknown URL → `custom`

**`tests/ai/prompts.test.ts`** — `src/core/ai/prompts.ts`:

- `buildCommitSystemPrompt('auto')` does not add a language line
- `buildCommitSystemPrompt('en')` adds the English instruction; `'ru'` adds both Russian and English variants plus the rule to keep technical English terms untranslated
- `buildCommitUserPrompt` includes the diff verbatim when ≤ `MAX_DIFF_CHARS = 6000`; truncates with a `[diff truncated, N chars omitted]` marker preserving head and tail

### 21. fileTree (`tests/changes/fileTree.test.ts`)

Module: `src/renderer/src/features/changes/fileTreeModel.ts`

- `buildFileTree` builds a folder tree from a flat `FileStatus[]`
- Folders are sorted before files; case-insensitive natural ordering inside each level
- Trailing slashes in `path` are normalized
- `collectFiles(node)` flattens all files under a node — used by the folder context menu (stage/unstage/discard/delete on a whole folder)

---

## Coverage Summary

| Layer | Modules | Tests |
|-------|---------|-------|
| Git parsers | GitParser, DiffParser, ConflictParser, ReflogParser, BlameParser, SubmoduleParser, FileHistoryParser | ~90 |
| Graph | GraphLayout | ~5 |
| Git managers | WorktreeManager, GitExecutor (sanitizeArgs), RebaseManager | ~18 |
| Commands | writeCommands, readCommands, ConflictManager | ~32 |
| Utils | pathSecurity, repoPathGuard, AppError, Logger | ~40 |
| Safety | OperationQueue, AtomicWrite, OperationJournal, RecoveryManager, LongPathSuggester | ~32 |
| i18n | Key completeness en↔ru, tpl | ~15 |
| Managers | BisectManager, HooksManager, LfsManager (contracts) | ~10 |
| State | StateManager (multi-repo, isRepoTracked guard), repoSlice | ~10 |
| Services | RepoServicesRegistry (lifecycle, isolation) | ~7 |
| Activity | GitActivityStore (per-repo, cap, truncation) | ~13 |
| IPC | messages contracts, ipc/helpers (op repoPath snapshot), MessageBridge.handleCommand, handlersGitOps | ~40 |
| AI | AiConfigStore, AiHandlers, AiService, OpenAiCompatibleProvider, QwenWebProvider, prompts, presets | ~80 |
| Changes | fileTree (buildFileTree, collectFiles) | ~11 |
| Repo Manager | recentRepos (invalid path filtering) | ~3 |
| Main | gracefulShutdown | ~5 |
| **Total** | **<!-- TESTS_FILES -->58<!-- /TESTS_FILES --> files** | **<!-- TESTS_COUNT -->631<!-- /TESTS_COUNT -->** |

---

## Manual Testing for Git Features

Features that require a real Git repository need manual testing:

### Reflog

1. Open GitBor → Repository → Reflog
2. Verify the table shows HEAD history (checkout, commit, merge, etc.)
3. Click SHA — copies to clipboard
4. Click "Restore" — confirmation dialog, then `git reset --hard` to selected commit

### Git Bisect

1. Open Repository → Bisect
2. Enter bad commit SHA (has the bug) and good commit SHA (no bug)
3. Click "Start" — git checks out the midpoint
4. Inspect code, click "Good" or "Bad"
5. Repeat until the culprit commit is found
6. Click "Abort" at any time for `git bisect reset`

### Git Hooks

1. Open Repository → Git Hooks
2. Lists hooks from `.git/hooks/` (excluding `.sample`)
3. Toggle on/off — renames file with/without `.disabled` suffix
4. Click hook name to expand and view contents

### Signed Commits (GPG/SSH)

1. Configure: `git config commit.gpgsign true`
2. Make a commit — it appears in the graph with ✓ Signed badge (green)
3. Badge colors: green = verified (G), orange = untrusted (U/X/Y), red = bad (B/R)

### Worktrees

1. Open Repository → Worktrees
2. Lists main and additional worktrees
3. Click "Add" — specify path and branch (or create new)
4. Remove button with confirmation (cannot remove main worktree)

### Git LFS

1. Ensure `git lfs` is installed (`git lfs install`)
2. Open Repository → Git LFS
3. Status: shows whether LFS is installed
4. Tracked patterns: list from `.gitattributes`
5. Add pattern (e.g. `*.psd`) — added to `.gitattributes`
6. File list: all LFS-managed files

---

## Adding New Tests

1. Create a file in `tests/` with `.test.ts` suffix
2. Import the module under test:

```ts
import { describe, it, expect } from 'vitest';
import { myFunction } from '../../src/core/path/MyModule';
```

3. Write tests:

```ts
describe('myFunction', () => {
  it('returns empty for empty input', () => {
    expect(myFunction('')).toEqual([]);
  });
});
```

4. Run: `npx vitest run tests/path/MyModule.test.ts`

---

## CI/CD

Two complementary workflows:

**`.github/workflows/ci.yml`** — runs on `push` to `main`/`develop`:

```yaml
# Matrix: ubuntu-latest, windows-latest, macos-latest with Node 20
steps:
  - npm ci                              # Install root deps
  - npm ci (src/renderer)               # Install renderer deps
  - npm run lint                        # ESLint check
  - npx tsc -p tsconfig.main.json       # TypeScript check (main + core)
  - npx tsc -b (src/renderer)           # TypeScript check (renderer)
  - npm test                            # Vitest (<!-- TESTS_COUNT -->631<!-- /TESTS_COUNT --> tests in <!-- TESTS_FILES -->58<!-- /TESTS_FILES --> files)
  - npm run build:renderer              # Vite build
  - npm run build:main                  # tsc main process
```

**`.github/workflows/pr.yml`** — gate on `pull_request` to `main` (Windows-only, Node 22):

```yaml
build:
  runs-on: windows-latest
  steps: same as ci.yml (lint / tsc / test / build)
e2e:
  needs: build
  runs-on: windows-latest
  steps:
    - npm ci (root + renderer)
    - npm run build
    - npx playwright test                # 3 specs, ~27s
    - upload tests-e2e/_report on failure
```

`npm test` runs `vitest run` — single pass with exit code 0 on success, 1 on failure. `npm run e2e` runs Playwright; specs are `test.skip(process.platform !== 'win32')` so they're a no-op on Mac/Linux.

### E2E (Playwright + Electron)

3 specs in `tests-e2e/`:

| Spec | Scenario | Time |
|------|----------|------|
| `app-launch.spec.ts` | Application launch, `[data-testid=titlebar]` visible. | ~7.5s |
| `open-repo.spec.ts` | Launch with `cwd=fixture` → autoOpenRepo picks it up → TitleBar + Sidebar + "main" text visible. | ~4.2s |
| `switch-tab.spec.ts` | Launch with fixture A → open fixture B via `window.gitBorAPI.invoke({ type: 'openRepo', path: B })` → click `[data-testid=repo-tab-0]` and `[data-testid=repo-tab-1]`. | ~12.9s |

Helpers in `tests-e2e/helpers.ts`: `launchApp({ cwd? })` and `makeFixtureRepo(prefix)` (creates a temp git repo with an initial commit, cleanup in `finally`).

### Pre-commit and pre-push hooks

`.husky/pre-commit` (lightweight, ~1–2s):

1. `npx lint-staged` — `eslint --fix` on staged `*.{ts,tsx}` files (auto-fix and re-stage).
2. If any TS/TSX is staged, project-wide `npx tsc --noEmit -p tsconfig.main.json && npx tsc --noEmit -p src/renderer/tsconfig.json` (per-file `tsc` is meaningless — types depend on the whole project).

`.husky/pre-push` (~5–7s):

1. `npm test` (Vitest, <!-- TESTS_COUNT -->631<!-- /TESTS_COUNT --> tests in <!-- TESTS_FILES -->58<!-- /TESTS_FILES --> files) — full suite to catch regressions before they reach the remote.
2. Bypass: `SKIP_TESTS=1 git push` — for branches that touch only docs/configs and have no code under test.

Split rationale: keep commits cheap (lint-staged + tsc), put the full test suite at push time where the latency is acceptable and the safety net catches red trees before they hit the remote.

### Coverage

```bash
npm run test:coverage    # Vitest with v8 coverage
```

Configuration in `vitest.config.ts` under `test.coverage`.

### Bundle analyzer

```bash
npm run analyze          # Builds with rollup-plugin-visualizer → docs/audit/bundle-<today>.html
```

Sets `GITBOR_ANALYZE=1` so `vite.config.ts` enables the visualizer treemap (gzip + brotli sizes, `open: false`).
