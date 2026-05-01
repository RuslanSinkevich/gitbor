> Русская версия: [docs/ru/testing.md](ru/testing.md)

# Testing SkyFork

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
│   ├── AiConfigStore.test.ts     # Provider config, encryption via safeStorage
│   ├── AiHandlers.test.ts        # AI IPC handlers
│   ├── AiService.test.ts         # generateCommitMessage, testConnection
│   ├── OpenAiCompatibleProvider.test.ts # SSE parser, finishReason, usage
│   └── prompts.test.ts           # buildCommitSystemPrompt / buildCommitUserPrompt
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
- ENV `SKYFORK_LOG_LEVEL=warn` overrides the default
- Invalid `SKYFORK_LOG_LEVEL` is ignored (falls back to `isProduction`)

### 19. repoPathGuard (`tests/utils/repoPathGuard.test.ts`)

Module: `src/core/utils/repoPathGuard.ts`

- Empty/non-string path → `dangerous: true`
- Current user home directory, drive root (`C:\`, `/`), `\Users` root → `dangerous`
- Windows system roots: `C:\Windows`, `C:\Program Files`, `C:\ProgramData`
- POSIX system roots: `/etc`, `/usr`, `/var`, `/home`, `/Users`
- Normal project paths → `dangerous: false`

---

## Coverage Summary

| Layer | Modules | Tests |
|-------|---------|-------|
| Git parsers | GitParser, DiffParser, ConflictParser, ReflogParser, BlameParser, SubmoduleParser, FileHistoryParser | ~90 |
| Graph | GraphLayout | ~5 |
| Git managers | WorktreeManager, GitExecutor (sanitizeArgs), RebaseManager | ~18 |
| Commands | writeCommands, readCommands, ConflictManager | ~32 |
| Utils | pathSecurity, repoPathGuard, AppError, Logger | ~40 |
| Safety | OperationQueue, AtomicWrite, OperationJournal | ~16 |
| i18n | Key completeness en↔ru, tpl | ~15 |
| Managers | BisectManager, HooksManager, LfsManager (contracts) | ~10 |
| State | StateManager (multi-repo, isRepoTracked guard), repoSlice | ~10 |
| Services | RepoServicesRegistry (lifecycle, isolation) | ~7 |
| Activity | GitActivityStore (per-repo, cap, truncation) | ~13 |
| IPC | messages contracts, ipc/helpers (op repoPath snapshot) | ~21 |
| AI | AiConfigStore, AiHandlers, AiService, OpenAiCompatibleProvider, prompts | ~30 |
| **Total** | **37 files** | **347** |

---

## Manual Testing for Git Features

Features that require a real Git repository need manual testing:

### Reflog

1. Open SkyFork → Repository → Reflog
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

GitHub Actions workflow in `.github/workflows/ci.yml` runs on push/PR to `main` and `develop`:

```yaml
# Runs on ubuntu-latest, windows-latest, macos-latest with Node 20
steps:
  - npm ci                              # Install root deps
  - npm ci (src/renderer)               # Install renderer deps
  - npm run lint                        # ESLint check
  - npx tsc -p tsconfig.main.json       # TypeScript check (main + core)
  - npx tsc -b (src/renderer)           # TypeScript check (renderer)
  - npm test                            # Vitest (347 tests)
  - npm run build:renderer              # Vite build
  - npm run build:main                  # tsc main process
```

`npm test` runs `vitest run` — single pass with exit code 0 on success, 1 on failure.

### Coverage

```bash
npm run test:coverage    # Vitest with v8 coverage
```

Configuration in `vitest.config.ts` under `test.coverage`.
