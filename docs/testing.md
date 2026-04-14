> Русская версия: [docs/ru/testing.md](ru/testing.md)

# Testing SkyFork

## Stack

| Component | Version |
|-----------|---------|
| Framework | [Vitest](https://vitest.dev/) 3.x |
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
│   └── WorktreeManager.test.ts   # WorktreeInfo interface contract
│
├── safety/
│   └── OperationQueue.test.ts    # Operation queue (read/write, serialization, errors)
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

**`parseSubmoduleStatus`:** clean (` `), modified (`+`), uninitialized (`-`), multiple submodules.

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

- `WorktreeInfo` interface contract (all required fields)

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

---

## Coverage Summary

| Layer | Modules | Tests |
|-------|---------|-------|
| Git parsers | GitParser, DiffParser, ConflictParser, ReflogParser, BlameParser, SubmoduleParser, FileHistoryParser | ~90 |
| Graph | GraphLayout | ~5 |
| Managers | WorktreeManager (contract) | ~1 |
| Safety | OperationQueue | ~8 |
| i18n | Key completeness en↔ru, tpl | ~15 |
| Managers | BisectManager, HooksManager, LfsManager, WorktreeManager (contracts) | ~10 |
| IPC | RendererCommand, MainEvent type contracts | ~10 |
| **Total** | **19 files** | **154** |

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

```yaml
# GitHub Actions
- name: Run tests
  run: npm test
```

`npm test` runs `vitest run` — single pass with exit code 0 on success, 1 on failure.
