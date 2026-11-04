# Cross-platform checklist (GitBor)

> Русская версия: [docs/cross-platform-checklist.md](../cross-platform-checklist.md)

> A living document of the current state. Only open tasks and what has to be
> checked by hand after the first run on macOS / Linux.

## Open items per platform

| Platform | Task | Priority |
|---|---|---|
| macOS | Real notarization (`mac.notarize: true` + Apple Developer ID + `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`) | low — needs an Apple Developer account |
| macOS | A real designed logo instead of the placeholder from `scripts/build-icons.mjs` | medium — needs an asset from a designer |
| macOS | Light/dark icon variant for the menu bar tray | low |
| Linux | Snap / Flatpak target in `package.json/build.linux.target` | medium |
| Linux | A real designed logo `resources/icon.png` (see above) | medium |
| Windows | Microsoft Store tile icons | low — only for a Store release |
| Cross | Bundled portable git for Windows (MinGit ~30 MB + a Settings UI to pick git + GPL-2 attribution in About) | low — a product decision, not a technical one |

## Out of scope

- **Apple Developer ID** — real signing + notarization needs a paid account, not configured. `mac.identity: "-"` + `mac.notarize: false` explicitly.
- **Bundled git** — GitBor uses the system git (`PATH` lookup in `GitExecutor`). Windows needs Git for Windows, macOS — Xcode CLT or brew, Linux — the distro package. `checkGitAvailable` + `showGitNotFoundMessage` catch a missing git at startup.
- **Cross-build from CI** — macOS / Linux releases are built on their own runners. A signed macOS build from a Windows runner is impossible (needs `codesign` from Xcode).

## What to check by hand (Mac / Linux runtime — next stream)

1. Run `npm run build && npm start` on macOS Ventura+ / Sonoma+.
2. Run on Ubuntu 22.04 / 24.04 (X11 and Wayland sessions) and Fedora (Wayland by default).
3. Open a repo with non-ASCII paths (Russian / Japanese / Chinese).
4. Open a repo with symlinks pointing outside — check how `safePath` behaves.
5. `electron-builder --mac --dir` after the first `npm run build:icons` run (`icon.icns` is generated as a placeholder).
6. `electron-builder --linux --dir` — the same for `icon.png` + check the `.deb` metadata is there.
7. `FileWatcher` on a large repo: on macOS a single FSEvents subscription (`fs.watch` recursive) — events arrive from nested folders, `node_modules` is filtered out; on Linux (chokidar) — it does not hit the inotify limit.
8. On macOS — how `mkdirSync({ mode: 0o700 })` behaves for `~/.ssh/` (the ACL applies as expected).
9. On Linux — `safeStorage` via `secret-service`: check that AI secrets are stored encrypted (no `plain:` fallback) when KWallet / gnome-keyring is present.
