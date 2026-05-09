> Русская версия: [docs/ru/features.md](ru/features.md)

## Features

### Commit Graph

- Virtualized scroll — renders only visible rows, handles 15000+ commits smoothly
- Branch coloring — each branch lane gets a unique color
- Click on commit — loads details + auto-selects first file diff
- Search commits (Ctrl+F) — by subject, author, or hash prefix

### Branch / Tag / Stash Sidebar

- Tree view with collapsible folders (feature/user/branch)
- Single click — scrolls graph to branch head commit, loads details + diff
- Double click — checkout branch
- Right-click — context menu: checkout, merge, rename, delete, new branch/tag
- Cannot delete the currently checked-out branch (option hidden)
- **Current branch marker** — green dot next to the name (no text badge cluttering the row)

### Local Changes

- Tree view grouped by folders (like Fork)
- Unstaged section on top, Staged on bottom
- Per-file actions: stage (+), unstage (-), discard
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

- Two modes: Inline and Split (side-by-side)
- Syntax highlighting with line numbers
- No `+`/`−` text prefix in line content — colored background only (cleaner copy-paste)
- Stage Hunk / Unstage Hunk buttons per hunk (both inline and split modes)
- Ignore Whitespace toggle
- Dark text on colored backgrounds for better readability
- Supports: working copy diff, staged diff, commit diff, untracked files, root commits

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

### AI Commit Messages

- One-click generation from staged diff
- **Two modes**:
  - **OpenAI-compatible** — works with OpenAI, Ollama, LM Studio, DeepSeek, Groq and any other `/v1/chat/completions` endpoint
  - **Qwen Web** — chat.qwen.ai via session token from `localStorage` (no DashScope API key needed)
- **Preset selector** with optgroups: Cloud (OpenAI / DeepSeek / Groq), Local (Ollama / LM Studio), Web (Qwen Web), plus Custom
- **Commit language**: `auto` / `en` / `ru` (the system + user prompts both carry the language hint to compensate for small/quantized local models that ignore the system prompt)
- Streaming (SSE): chunks land in the commit subject field as they arrive
- **Cancel** button aborts the inflight request via `AbortController`
- **Test connection** button before saving
- API key / Qwen token encrypted via Electron `safeStorage` (DPAPI / Keychain / libsecret); fallback to `plain:` prefix if key store is unavailable
- Diff truncated to 6000 chars (head 70% + tail 20%) to fit the model's context window
- Accessible via the AI button next to the commit subject

### Interactive Rebase

- Rebase editor with pick/reword/edit/squash/fixup/drop actions
- Rebase progress banner with step counter and Continue/Skip/Abort buttons
- Accessible from commit context menu

### Toolbar

- Quick actions: Fetch, Pull, Push, Stash, Stash Pop
- **Stash dialog** — name field with `allowEmpty`; empty value runs `git stash` without `-m`
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

### Compare Two Commits

- Right-click a commit → "Compare From Here"
- Right-click another commit → "Compare with 'abc1234'" to see file changes between them

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

### Distribution

- Electron-builder config for Windows (NSIS + portable), macOS (DMG), Linux (AppImage + deb)
- Build: `npm run dist:win`, `npm run dist:mac`, `npm run dist:linux`
