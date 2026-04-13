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

### Local Changes

- Tree view grouped by folders (like Fork)
- Unstaged section on top, Staged on bottom
- Per-file actions: stage (+), unstage (-), discard
- Stage All / Unstage All buttons
- Discard All with confirmation dialog
- Conflict files marked with (!) icon
- Auto-closes diff panel when file disappears after commit

### Commit Bar

- Separate Subject and Description fields (like Fork, GitKraken)
- Enter in subject moves focus to description
- Ctrl+Enter commits from either field
- Amend checkbox

### Diff Viewer

- Two modes: Inline and Split (side-by-side)
- Syntax highlighting with line numbers
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
- Quick switch between repos

### Interactive Rebase

- Rebase editor with pick/reword/edit/squash/fixup/drop actions
- Accessible from commit context menu

### Toolbar

- Quick actions: Fetch, Pull, Push, Stash, Stash Pop
- Disabled during running operations

### Custom Menu Bar

- HTML/CSS menu in the renderer (replaces unstable native Electron menu on Windows)
- Menus: File, View, Repository, Branch, Help
- Keyboard accelerators still work via hidden native menu
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
