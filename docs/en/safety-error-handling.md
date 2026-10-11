# Safety & Error Handling

> Русская версия: [docs/safety-error-handling.md](../safety-error-handling.md)

GitBor classifies git errors and does NOT auto-rollback on every failure.
The user sees a modal `SafetyDialog` with suggested actions (retry / abort
merge / restore stash / kill git process / remove index.lock / rollback).

## Architecture

```
UI (Renderer)          IPC          WriteCommand       Preflight    SafetyNet         Classifier      Git
   |                    |                |                  |             |                 |           |
   | merge(branch) -->  |                |                  |             |                 |           |
   |                    | merge --->     |                  |             |                 |           |
   |                    |                |   check(op) ---> |             |                 |           |
   |                    |                |   blocked? -> ok=false → suggestedActions          |           |
   |                    |                | wrapDestructive(allowedErrorClasses=['conflict'])----->     |
   |                    |                |                  |             | UU check ───────────────>  |
   |                    |                |                  |             | stash push (if local edits)
   |                    |                |                  |             | merge ----------------->   |
   |                    |                |                  |             | exitCode != 0?             |
   |                    |                |                  |             | classify(stderr)->class    |
   |                    |                |                  |             | conflict → success:false, conflicts:[] (NO rollback)
   |                    |                |                  |             | transient/unknown → OperationFailure + suggestedActions (NO rollback)
   |                    |                | <-----------------------       |                 |           |
   |                    | operationEnd { errorClass, savedState, suggestedActions } <----    |           |
   | useOperationToasts sees errorClass → does NOT show a toast                                         |
   | useSafetyDialog opens SafetyDialog with action buttons                                             |
   | user picks → postCommand → execution (stashApply / resetTo / retry / abortMerge / ...)            |
```

**Invariant:** rollback and stash-pop are performed only by the user through
the UI. The backend prepares options, it does not make the decision.

## errorClass → suggestedActions table

| `GitErrorClass` | UI title | Default actions |
|---|---|---|
| `lock_held` | Another git process is running | `remove_lock`, `retry`, `cancel` |
| `conflict` | Merge conflicts | `continue_merge`, `abort_merge`, `cancel` |
| `dirty_tree` | Local changes would be overwritten | `rollback`, `cancel` |
| `merge_in_progress` | Merge in progress | `continue_merge`, `abort_merge`, `cancel` |
| `rebase_in_progress` | Rebase in progress | `abort_rebase`, `manual_continue`, `cancel` |
| `cherry_pick_in_progress` | Cherry-pick in progress | `continue_cherry_pick`, `abort_merge`, `cancel` |
| `revert_in_progress` | Revert in progress | `continue_merge`, `abort_merge`, `cancel` |
| `unmerged_paths` | Unresolved conflicts | `continue_merge`, `abort_merge`, `cancel` |
| `network` | Network error | `retry`, `cancel` |
| `auth` | Authentication failed | `retry`, `cancel` |
| `non_fast_forward` | Remote rejected push | `rollback`, `cancel` |
| `untracked_overwrite` | Untracked files would be overwritten | `rollback`, `cancel` |
| `preflight_blocked` | Operation blocked | (by issue — see `runPreflight` in writeCommands) |
| `unknown` | Operation failed | `rollback`, `cancel` |

When `SavedState.autoStashHash` holds a stash, `apply_stash_only` and
`drop_stash` are appended to the list (the user can pull it back right away).

For a cherry-pick conflict "Continue" is `continue_cherry_pick`
(`git cherry-pick --continue`), and "Abort merge" (`abort_merge`) detects the
active operation itself: with `CHERRY_PICK_HEAD` / `REVERT_HEAD` it runs
`cherry-pick --abort` / `revert --abort`, otherwise `merge --abort`.

## Auto-stash and rollback

- **Was a stash created?** Before an operation SafetyNet runs
  `git stash push -u`. When there is nothing to stash (e.g. changes only inside
  a submodule) git exits with 0 and creates no stash. So creation is detected
  by `refs/stash` moving (`readStashTip` before and after), not by the exit
  code — otherwise `stash@{0}` would be the user's own stash, applied and
  dropped after the operation. The manual "Stash" uses the same check to tell
  success from "nothing to stash".
- **Rollback order.** `rollback` first runs `checkout -f` to the saved branch
  (or `--detach` to the saved commit), then `reset --hard`. The other way round
  `reset` would move the branch the operation had switched to. Exit codes are
  checked: a failure is shown as an error, not a false success. After rollback
  the auto-stash is applied and dropped.

## Recovery actions

`RecoveryManager.executeRecovery` runs the action chosen in the dialog and
checks the exit code of every git command — a failure goes to the UI.

- `remove_lock` — removes `index.lock`, but not if it is younger than 2
  seconds (git may still be running): then a "try again in a few seconds"
  message is shown.
- `restore_stash` (an orphaned auto-stash on startup) — applies and drops the
  stash so the dialog does not come back on every launch.

## Git dir and locale

- All state files (`MERGE_HEAD`, `rebase-merge/`, `index.lock`, the journal,
  hooks) are located via `resolveGitDir()` / `resolveCommonGitDir()`
  (`src/core/git/gitDir.ts`). In linked worktrees and submodules `.git` is a
  `gitdir: …` file, and the former `join(repo, '.git')` could not find them.
- `GitErrorClassifier` recognizes classes from English stderr, so
  `GitExecutor` always runs git with `LC_MESSAGES=C`. Without it, under a
  Russian locale a merge conflict was treated as an "unknown error".

## Pre-flight checks

`PreflightChecks.check(repoPath, operation, opts?)` runs BEFORE a
destructive operation starts:

1. **`.git/index.lock`** — `<15s` → block (user decides: kill / remove);
   `≥15s` → silently removed.
2. **State files**: `MERGE_HEAD`, `rebase-apply/`, `rebase-merge/`,
   `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`.
3. **UU files** (`git diff --name-only --diff-filter=U`) — block ANY
   destructive operation, except the merge resolvers themselves
   (`completeMerge`, `abortMerge`, `resolveOurs`, `resolveTheirs`).
4. **Dirty tree** — only for `checkout` and `rebase` (the rest go through
   SafetyNet auto-stash).

On a block it returns `PreflightReport { ok: false, issues: [...] }`, which
writeCommands wraps into an `OperationFailure` with
`errorClass='preflight_blocked'` and suggestedActions derived from the
issue type.

## Cross-platform git process detection

`GitProcessDetector.findGitProcesses(repoPath?)`:

- **Windows**: `powershell Get-CimInstance Win32_Process -Filter "Name='git.exe'"`,
  parses the JSON output.
- **macOS / Linux**: `ps -ax -o pid,command`, filtered by `\bgit\b`.
- 2s timeout; on failure (PowerShell policy, no `ps`) returns an empty
  array (best-effort, non-blocking feature).

Used by SafetyDialog to show informative output on `lock_held`: the pid +
command line of the processes holding the lock.

## How to add a new error class

1. **`src/core/git/types/errors.ts`** — extend `GitErrorClass` with a new
   value.
2. **`src/core/git/GitErrorClassifier.ts`** — add a pattern to `PATTERNS[]`
   (order matters: specific on top, generic at the bottom).
3. **`src/core/safety/SafetyNet.ts`** — in `buildActions(errorClass, ...)`
   add a case for the new class with the appropriate `SuggestedAction[]`.
4. **`src/renderer/src/i18n/en.ts` + `ru.ts`** — in the `safety` section:
   - `titles.<class>` — dialog title
   - `descriptions.<class>` — description under the title
5. **`src/renderer/src/hooks/useSafetyDialog.ts`** — if the class should
   show a SafetyDialog (rather than a toast), add it to
   `SUPPRESS_TOAST_CLASSES`.
6. **Test**: add a fixture with real stderr to
   `tests/git/GitErrorClassifier.test.ts`.

## OperationJournal

After the refactor, `OperationJournal.fail(id, error, errorClass?)` takes
an optional `errorClass: GitErrorClass`. SafetyNet always passes it — the
journal keeps the class for later analysis (recovery after restart /
telemetry).

`safety-stats.json` in `userData/` is an optional per-class error counter.
Enabled when `GITBOR_SAFETY_STATS=1` or when the file already exists. No
network transmission.

## Performance: deferHeavy refresh

Write operations that add a single commit on top (`commit`, `merge`,
`cherry-pick`, `revert`, `pull`, `rebase`, `reset`, `restoreReflog`) get
`deferHeavy: true` in `refreshAll`:

- `refreshFast` + `refreshGraph(500)` are awaited (the user sees the first
  frame with fresh state in ~250ms).
- `refreshGraph(50000)` is fire-and-forget — the graph fills in in the
  background.

On monorepos (vscode / chromium) this saves 3-8 seconds between
`git commit` and a responsive UI.
