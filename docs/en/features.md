> Русская версия: [docs/features.md](../features.md)

## Features

### Commit Graph

- Virtualized scroll — renders only visible rows, handles 15000+ commits smoothly
- Branch coloring — each branch lane gets a unique color
- Click on commit — loads details + auto-selects first file diff
- **Double click on commit** — reveals the nearest named ref in the sidebar (BFS towards descendants until a branch/tag is found): opens the section, expands the ancestor folders and scrolls the row into view. No checkout
- **Auto-focus after write operations** — after commit / push / pull / checkout / fetchBranch / merge / cherry-pick / revert / rebase / reset / restoreReflog / createBranch the graph seeks to the resulting tip. `fetchBranch` / `createBranch` focus their own branch, not HEAD; if the tip is outside the loaded window, `Load more` runs and the seek repeats once the new page arrives
- Search commits (Ctrl+F) — by subject, author, or hash prefix
- **Author avatars** — small colored circle with author initials in every row; HSL hue is a deterministic hash of the email so the same contributor looks the same everywhere (Cyrillic supported, fallback to email local part)
- **Remote-only commits dimmed** — commits reachable from `refs/remotes/*` but not from any local branch render at ~0.45 node / ~0.35 line opacity; hover boosts to 0.9 to make them readable
- **Refreshes by itself** — commits, checkouts and fetches made in a terminal or another app show up without F5, including branches with folders (`feature/name/task`) and linked worktrees

### Commit Menu

Right-click a commit. The header shows the short hash and subject; explanations for non-obvious items are in tooltips.

- **Frequent items at the root** — Copy SHA, Copy message, Cherry-pick (or "Cherry-pick N commits" with multi-select), Revert
- **Create** — New branch from here (Ctrl+Shift+B), New tag (Ctrl+Shift+T)
- **"On ‘current branch’" ▸** — everything that changes the current branch: move the last commit back to staged, merge this commit, rebase (regular and interactive), reset to this commit (soft / mixed / hard with confirmation)
- **Check out commit** and explicit "Switch to ‘branch’" items for local branches on this commit
- **Branches containing it** — a dialog: key branches (develop, stage, prod, main, master, release…) with ✓ / ✗ on top, every branch that contains the commit below. A branch counts as containing the commit if its local or remote copy does
- **Open in Azure DevOps / GitHub / GitLab** — the commit page in the browser; the URL is built from the remote URL (Azure DevOps — cloud and on-prem TFS with a collection). Not shown for unknown hosts
- **Open pull request N** — on merge commits whose message has a PR number ("Merged PR …", "Merge pull request #…", "See merge request …!N", and the Russian Azure wording)
- **More ▸** — annotated tag, compare with the working copy, save as patch, copy commit info

### Ahead/Behind Indicators

- Pull button shows a `behind` badge — how many commits the current branch's upstream has that you have not pulled yet
- Push button shows an `ahead` badge — how many local commits are not on the upstream yet
- Counts > 99 render as `99+`; the badge disappears at zero
- Fetch button stays badge-free (it is not branch-scoped)
- Tooltip on Pull/Push expands the number into a localized phrase

### Branch / Tag / Stash Sidebar

- Tree view with collapsible folders (feature/user/branch)
- Single click — scrolls graph to branch head commit, loads details + diff
- Double click — checkout branch (remote branch → Track dialog). On a hybrid «branch + folder» node (both `release` and `release/1.0` exist) the first double click expands the children, checkout happens on the second
- Double click on a folder always expands it — the two `click` events no longer collapse it back
- Hybrid «branch + folder» rows get their own arrow in the left padding, so names stay aligned
- After checkout / track the current branch is selected, its ancestor folders are expanded and the row is scrolled into view — it no longer hides inside a collapsed folder
- **Branch menu** (right-click) — the branch name once in the header, only actions in items, so the menu stays narrow for any name length. Groups: Switch to / Update branch (fetch) → Merge into ‘current’ / Compare ▸ → New branch / tag from here → In graph ▸ (show only this, hide, pin), Note, Copy name → Rename / Delete (always last, delete in red)
- **Update branch (fetch)** — pulls new commits of an inactive branch from the server without switching to it (fast-forward only); without an upstream it asks for the remote and remembers it
- **Remote branch** — "Create local and track…": a local branch with tracking, then switches to it; long names wrap in the dialog instead of being cut off
- The current branch has no Switch, Update, Merge, Compare or Delete items
- **Current branch marker** — green dot next to the name (no text badge cluttering the row)
- **Hover-actions per branch** (Fork-style): pin / solo / hide / note icons appear on hover; active state stays visible without hover so you can see filter state at a glance. Per-repo state, stored in `localStorage`
- **Branch filter for the graph (Solo)** — shows only the selected branch, without extra git calls. The banner above the graph has a mode switch and a "Show all" button:
  - **Own commits** (default) — the branch's own line by first parent (`git log --first-parent`): its commits and merge commits without the history of develop / main merged into it. Drawn as one straight lane
  - **Full history** — every commit reachable from the branch (`git log <branch>`)
  - The chosen mode is remembered
- **Hide branch from graph** — eye-off icon completely removes the branch's commits from the graph (BFS-subtraction: a commit stays visible if any non-hidden local branch can reach it). Same banner with "Unhide all" to clear; if every branch is hidden the graph shows an empty-state with "Show all branches"
- **Branch notes** — info icon opens a textarea modal for free-form per-branch notes (links, ticket numbers, intent). Hover the icon — a tooltip shows the first 200 characters. Notes are stored locally per repo (`sg-branch-notes:<repo>`), never written to git config

### Local Changes

- Tree view grouped by folders (like Fork)
- Unstaged section on top, Staged on bottom
- Per-file actions: stage (+), unstage (-), discard; in the diff — per hunk and per line (including unstaging selected lines and files without a trailing newline)
- **Folder context menu** — stage / unstage / discard / delete applied to all files inside (works in both Staged and Unstaged sections); folder-level actions go through batch IPC commands (`discardFiles` / `deleteUntrackedFiles`) — one round-trip and one `git checkout -- a b c …` instead of N invokes
- Stage All / Unstage All buttons
- Discard All with confirmation dialog
- Conflict files marked with (!) icon
- Auto-closes diff panel when file disappears after commit
- Pure tree helpers (`buildFileTree`, `collectFiles`) extracted to `fileTreeModel.ts` for direct unit testing

### Commit Bar

- Separate Subject and Description fields (like Fork, GitKraken)
- Enter in subject moves focus to description
- Ctrl+Enter commits from either field
- Amend checkbox

### Diff Viewer

- Two layouts: Inline and Split (side-by-side) + an independent **Whole File** toggle (the full file in the chosen layout — one or two columns)
- New and fully deleted files are always shown in a single column (Split is disabled for them — nothing to compare against); same in the fullscreen compare modal
- Syntax highlighting with line numbers
- No `+`/`−` text prefix in line content — colored background only (cleaner copy-paste)
- **Hover-overlay hunk actions** (Fork-style): hover a hunk → thin primary frame appears around the block and Stage / Discard… / Unstage buttons float in the top-right corner. No persistent header bar per hunk — diff reads as clean code and fits more blocks per screen.
- Compact `@@ -old +new @@` header per hunk: dimmed by default, brightens on hover (no sticky background)
- Ignore Whitespace toggle
- Theme-aware diff colors — translucent line backgrounds tuned per theme (light text in dark mode, dark text in light mode); no harsh bright blocks in dark mode
- Supports: working copy diff, staged diff, commit diff, untracked files, root commits
- **Right-click → Copy**: ПКМ on diff content opens a context menu with **Copy** — either current text selection (`window.getSelection()`) or the hovered line (rows tagged with `data-diff-line`, works in inline/split/whole-file). Local to the diff feature, doesn't conflict with the global App-level context menu
- **Markdown preview** for `.md` / `.markdown` files: a Markdown-icon button appears in the diff toolbar (and inside `CompareModal`); clicking opens a wide modal (up to 1280 px) with the file rendered as rich text (not a diff). Content is fetched via `getFileText` IPC — for `WORKING` reads the working copy via `fs.readFile`, for any commit / `STAGED` / `a..b` / `PREV:hash` ref uses `git show <hash>:<file>`. The modal is lazy-loaded (Markdown parser ships as a separate chunk)
- **Legacy file encodings** — `git diff` output is captured as a `Buffer` (via `GitExecutor.execBuffer`) and decoded with `decodeGitText` heuristics: BOM (UTF-8 / UTF-16 LE / BE) → strict UTF-8 → CP1251 (Windows Cyrillic) → CP866 (DOS Cyrillic). Cyrillic comments in `.sql` / `.cs` / `.pas` files saved on legacy Windows render as readable text instead of mojibake (` ` and friends). Same heuristic applies to `getFileText` for the Markdown preview

### Merge Conflict Resolution

- Merge Branch dialog with options: Default, No Fast-Forward, Squash, Don't Commit
- Conflict prediction before merge
- Yellow merge-in-progress banner with Abort button (with confirmation)
- Auto-selects first conflicted file when merge starts
- Auto-advances to next conflict after resolving one
- Two-column Merge Editor: Ours (left) vs Theirs (right)
  - Click on conflict block to select which side to keep
  - Resolve button writes result and stages file
- Use Ours / Use Theirs quick actions from context menu

### File History

- Shows all commits that touched a specific file
- Accessible via right-click context menu on any file
- Click entry to view diff at that commit

### Git Blame

- Line-by-line annotation with author, date, commit hash
- Click hash to navigate to commit
- Accessible via right-click context menu

### Multi-Repository Tabs

- Open multiple repositories simultaneously
- Tab bar with repo names
- Quick switch between repos (instant — UI mirrors the cached slice immediately, heavy refresh runs in background)
- **`+` tab opens RepoManager** — recent repositories, open / clone / init from one place
- Clicking the active tab again also opens RepoManager
- Independent per-repo engines: a long `git pull` on repo A never blocks operations on repo B
- Per-repo running ops: `state.isOperationRunning` is derived from the active tab only; fetch on A doesn't disable buttons on B
- **Session persistence** — the full list of open tabs is restored on startup, with focus on the last active tab. Stored in `localStorage` (`sg-open-repos` + `sg-last-active-repo`); deleted/missing repos are silently dropped from the list on the next save

### AI Commit Messages

- One-click generation from staged diff
- **Two modes**:
  - **OpenAI-compatible** — works with OpenAI, Ollama, LM Studio, DeepSeek, Groq, YandexGPT and any other `/v1/chat/completions` endpoint
  - **Qwen Web** — chat.qwen.ai via session token from `localStorage` (no DashScope API key needed)
- Streaming (SSE): chunks land in the commit subject field as they arrive
- **Cancel** button aborts the inflight request via `AbortController`
- **Test connection** button before saving
- API key / Qwen token encrypted via Electron `safeStorage` (DPAPI / Keychain / libsecret); fallback to `plain:` prefix if key store is unavailable
- Diff truncated to 6000 chars (head 70% + tail 20%) to fit the model's context window
- Accessible via the AI button next to the commit subject

### AI Settings dialog

- **Six tabs on the left rail**: Connection / Prompts / Features / Behavior / Privacy / Debug. Each section is one file under `src/renderer/src/features/ai/sections/`
- **Preset list**, in priority order for the import-substitution audience:
  1. **Local** — Ollama (default), LM Studio, llama.cpp server. Data never leaves the machine
  2. **Corporate** — Qwen Corporate (vLLM / DashScope), Custom OpenAI-compatible gateway. User supplies baseUrl, system-in-user / strip-think defaults applied automatically for Qwen Corporate
  3. **No-VPN** — Qwen Web, Qwen API (Alibaba Cloud), DeepSeek
  4. **Russian** — YandexGPT via Yandex Cloud OpenAI-compatible endpoint (GigaChat in backlog — needs a separate OAuth provider)
  5. **Foreign** — OpenAI, Anthropic, Groq
- **Prompts on disk** are English (`DEFAULT_PROMPTS` in `src/core/ai/prompts.ts`). LLMs (including Qwen and YandexGPT) reason better in English. The reply language is added in the last line of the prompt via `resolvePrompt(id, cfg)` based on the **AI response language** setting in Behavior — applies uniformly to every feature, including stash names (git stores stash messages as UTF-8)
- **Per-feature toggle and per-feature model override** — switch any AI capability off, or point an individual feature (e.g. stash naming) at a cheaper model than the main provider
- **Privacy gate** — `allowCloudCodeShare` (default `false` for new installs) blocks calls to **foreign** providers (OpenAI / Anthropic / Groq). Local / corporate / no-VPN / Russian providers are always allowed and bypass the gate by design
- **Config v3** — old `ai-config.json` (v2) is migrated on load: `commitLanguage` becomes `aiResponseLanguage`, `features.commitMessage=true`, `aiEnabled=true`, `allowCloudCodeShare=false` (no implicit cloud opt-in)

### AI Helpers

Beyond commit messages, the same provider / privacy settings power five extra helpers. Each is a separate `AiFeatureId` (`explainCommit` / `stashName` / `explainReflog` / `analyzeConflict` / `semanticSearch`), can be toggled off in the **Features** tab, and can point at its own model override. All prompts live in `src/core/ai/prompts.ts` (English by default; response language appended via `resolvePrompt`).

- **Commit Explainer** — **Explain** button in the Commit Details panel. The model returns a fixed three-section summary (`What changed` / `Why` / `Watch out for`), high-level, not a line-by-line walkthrough. Useful for reviewing PRs, old releases and merge commits.
- **Smart Stash Naming** — **Suggest** button next to the name field in the stash dialog; proposes a 3-7 word lowercase name from the uncommitted diff. The field stays editable; Suggest only seeds it. Re-click to regenerate.
- **Reflog Explainer** — **Explain reflog** button in the Reflog dialog. Turns raw reflog lines into a plain `Timeline` / `Lost commits` / `Recovery` story, grouping low-level actions and flagging strandable commits with the exact recovery command.
- **Conflict Helper** — **Explain conflict** button in the merge editor toolbar. Explains the selected hunk in four sections (`Ours` / `Theirs` / `Risk` / `What to check`) — it does **not** auto-resolve; the choice stays with the user.
- **Semantic Search (MVP)** — the commit-graph search (Ctrl+F) understands an `ai:` prefix. The query + a recent slice of history (subject + body) is sent to the model, which reranks commits by meaning (`SEMANTIC_SEARCH_SYSTEM_PROMPT`). No embeddings yet — only the most recent N commits are considered; full-history indexed search is on the roadmap.

Common behavior: streaming where it makes sense, a second click on the active button cancels the inflight request, provider errors surface inline without blocking the UI, and the **Debug** tab always shows the exact request/response. Foreign providers (OpenAI / Anthropic / Groq) stay blocked unless the Privacy switch is on.

### Interactive Rebase

- Rebase editor with pick/reword/edit/squash/fixup/drop actions
- Rebase progress banner with step counter and Continue/Skip/Abort buttons
- Accessible from commit context menu
- Empty / loading states render the full editor frame with a Cancel button — the modal is always closeable

### Cherry-pick / Revert on Merge Commits

- For non-merge commits the context menu runs `git cherry-pick <hash>` / `git revert --no-edit <hash>` as usual
- For merge commits (`commit.parents.length > 1`) the menu auto-passes `-m 1` (mainline = first parent) — no more `commit is a merge but no -m option was given` failure
- IPC payload: `{ type: 'cherryPick' | 'revert', hash, mainline?: 1 }`

### Toolbar

- Quick actions: Fetch, Pull, Push, Stash, Stash pop
- **"Stash changes" dialog** — the name is optional (empty = `git stash` without `-m`), AI name suggestion button; "Include new files" is on by default and remembered. When there is nothing to stash (e.g. only new files without the checkbox), a hint is shown instead of a false "Changes stashed"
- Disabled during running operations on the active repo only (other tabs stay interactive)

### Custom Menu Bar

- HTML/CSS menu in the renderer (native Electron menu fully removed)
- Menus: File, Edit, View, Repository, Branch, Help
- Edit menu: Undo, Redo, Cut, Copy, Paste
- Keyboard shortcuts via `useKeyboardShortcuts` hook (Ctrl+O, Ctrl+Shift+F, F5, etc.)
- Smooth hover behavior across all platforms

### SSH Keys Manager

- View all SSH keys from `~/.ssh/`
- Generate new keys (Ed25519 or RSA) with passphrase
- Copy public key to clipboard
- Delete keys
- Accessible via File → Configure SSH Keys...

### Repository Settings

- View/edit `user.name` and `user.email` for current repository
- Toggle between global and local git credentials
- Accessible via Repository → Repository Settings...

### Confirmation Dialogs

- Destructive actions require confirmation: delete branch, delete tag, drop stash, remove remote, hard reset, discard changes, abort merge

### Toast Notifications

- Success/error notifications for Git operations (fetch, pull, push, commit, etc.)
- Dark text on colored backgrounds for both themes

### Git Activity Log

- Per-repo journal of git invocations (start / append / finish)
- Shows raw `git ...` commands, stdout/stderr, exit code, duration
- `gitActivityStore` keeps the last 100 entries; stdout/stderr truncated to 16 KiB with a `[truncated...]` marker
- `activityContext.ts` (`AsyncLocalStorage`) attributes every `GitExecutor.exec` call to its operation without manual id propagation
- Indicator in the title bar shows how many ops are running on the active repo

### Repository Statistics

- Contributors with commit counts and lines added/removed per author
- Activity heatmap per contributor
- Per-author stats are cached on disk (`AuthorStatsCache`) — second open is instant
- Accessible via Repository → Statistics

### Reflog Viewer

- Full `git reflog` history with action badges (checkout, commit, merge, etc.)
- Copy commit SHA to clipboard
- Restore (hard reset) to any reflog entry with confirmation
- Accessible via Repository → Reflog...

### Git Bisect

- Start bisect with bad/good commit hashes
- Interactive session: Mark Good, Mark Bad, Skip
- Shows current commit hash, estimated steps remaining
- Real-time git output log
- Abort bisect at any time
- Accessible via Repository → Bisect...

### Git Hooks Manager

- Lists all hooks in `.git/hooks/` (excluding `.sample` files)
- Enable/disable hooks via toggle (renames with `.disabled` suffix)
- Expand to view hook contents
- Accessible via Repository → Git Hooks...

### Signed Commits (GPG/SSH)

- Shows ✓ Signed badge on verified commits in the graph
- Supports: Good (G), Bad (B), Untrusted (U), Expired (X), Revoked (R)
- Color-coded: green (verified), orange (untrusted/expired), red (bad/revoked)

### Git Worktrees

- List all worktrees with branch, path, and SHA
- Add new worktree (existing or new branch)
- Remove worktree with confirmation
- Main worktree marked with badge
- Accessible via Repository → Worktrees...

### Git LFS

- Shows LFS installation status
- Lists tracked patterns from `.gitattributes`
- Add/remove tracking patterns
- Lists all LFS-managed files with OID
- Accessible via Repository → Git LFS...

### .gitignore Editor

- Create or edit `.gitignore` from the UI
- Predefined templates: Node.js, Python, Java, C/C++, Rust, Go, IDE, OS
- Click templates to add/remove patterns
- Manual editing in built-in textarea
- Warning if existing `.gitignore` will be overwritten
- Accessible via Repository → .gitignore...

### Compare

- **Two branches** — branch menu → Compare ▸:
  - "What it brings into ‘current’" — this branch's changes since it diverged from the current one
  - "What ‘current’ brings here (like a PR)" — the same as a pull request from the current branch into this one
  - Comparison starts at the merge base, not tip to tip, so new commits of the other branch never look "deleted"
- **Commit vs working copy** — commit menu → More ▸ → Compare with local changes
- **Two file versions** — in "File history": pick a base version and compare with another
- The result is a file list in the "Changes" tab, diff on click; a banner above the tabs says "Comparing: what X brings into Y" with the number of commits unique to each branch

### Arrow Key Navigation

- Use ↑/↓ arrows to navigate between commits in the graph
- Auto-scrolls to keep the selected commit visible

### Shell Integration

- Open in File Explorer (Ctrl+Alt+O)
- Open in Terminal (Ctrl+Alt+T)
- Refresh (F5)

### Error Boundary

- React ErrorBoundary catches unhandled UI errors
- Shows "Something went wrong" with a Reload button instead of a blank screen

### i18n

- English and Russian UI
- Language toggle in title bar

### Themes

- Dark and Light mode
- Theme toggle in title bar
- CSS variables (`--sg-*`) for consistent theming

### Windows long-path auto-suggest

- On Windows, when git fails with `Filename too long`, a single dialog offers to enable `git config --global core.longpaths true` (per-session single-shot, "Enable / Not now / Learn more")
- `LongPathSuggester` hooks `GitExecutor.setStderrInspector` and skips when the option is already enabled globally
- Bypassed entirely on macOS / Linux

### Auto-update

- The installed version checks GitHub Releases, downloads updates in the background and offers to restart
- The update dialog lists "what's new" in the UI language (it travels with the update in `latest*.yml`)
- The No AI build only updates to No AI, the regular build only to regular
- Manual check: About → "Check for updates". The portable version does not auto-update

### Distribution

- Windows (NSIS installer + portable), macOS (DMG for Intel and Apple Silicon), Linux (AppImage + deb + rpm); every platform has a No AI variant
- Releases are built by GitHub Actions on a `vX.Y.Z` tag; locally — `npm run dist:win` / `dist:mac` / `dist:linux`
