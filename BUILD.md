# Building GitBor

Cross-platform desktop Git client. This document describes how to build
distributable artifacts on each platform.

## Prerequisites

- Node.js 22+
- npm 10+
- Git (any recent version)

Platform-specific:

- **Windows**: nothing extra; PortableGit recommended for runtime, but
  not required for build.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`) for `git`
  and code signing utilities. For DMG: macOS Sonoma+.
- **Linux**: `fakeroot` and `dpkg` for `.deb`; AppImage builds without
  extra system packages on Ubuntu 22.04+.

## Build

Standard build (no packaging):

```bash
npm install
cd src/renderer && npm install && cd ../..
npm run build
```

This produces `dist/main/`, `dist/preload/`, `dist/renderer/`.

## Packaging

Generate placeholder icons (one-time, before first packaging):

```bash
npm run build:icons
```

This creates `resources/icon.{ico,icns,png}` from a template. They are
gitignored — regenerate locally as needed.

### Windows (.exe NSIS installer + portable)

```bash
npm run dist:win
```

Output: `release/GitBor-Setup-X.Y.Z.exe`, `release/GitBor-Portable-X.Y.Z.exe`
(no spaces — matches `latest.yml` for auto-update).
(portable). NSIS installer optionally enables Win10 LongPathsEnabled
registry (requires admin during install) — see `build/installer.nsh`.

Code signing: not configured. Add `CSC_LINK` (path to .pfx) and
`CSC_KEY_PASSWORD` to env to enable.

### macOS (.dmg)

```bash
npm run dist:mac
```

Output: `release/GitBor-X.Y.Z.dmg`.

Code signing: ad-hoc (`mac.identity: null`). For Developer ID signing,
unset `CSC_IDENTITY_AUTO_DISCOVERY: false` in CI and provide:

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (notarization)
- Or `CSC_LINK` + `CSC_KEY_PASSWORD` for explicit cert.

`mac.notarize: false` is the default — flip to `true` and add Apple ID
env to enable notarization.

Hardened runtime is on. Entitlements at `build/entitlements.mac.plist`.

### Linux (AppImage + .deb)

```bash
npm run dist:linux
```

Output: `release/GitBor-X.Y.Z.AppImage`, `release/gitbor_X.Y.Z_amd64.deb`.

`.deb` includes maintainer/synopsis/desktop entry. AppImage runs on most
glibc-based distros (Ubuntu 22.04+, Fedora 38+, Debian 12+).

## CI

- `.github/workflows/ci.yml` — lint + tsc + test + build on
  Windows/macOS/Ubuntu (matrix). No packaging.
- `.github/workflows/pr.yml` — Windows e2e via Playwright.
- `.github/workflows/release-pack.yml` — manual `workflow_dispatch` for
  smoke-packaging on all 3 platforms via `electron-builder --dir`.
  Artifacts uploaded for inspection. Does NOT sign or notarize.

### Running release-pack smoke locally

The `release-pack.yml` workflow is meant to be triggered manually — there
is no scheduled run. Two ways to fire it:

**Via GitHub CLI (any branch):**

```bash
gh workflow run "Release Pack Smoke" --ref main
```

Replace `main` with the branch you want to smoke-pack. The workflow runs
on Windows / macOS / Ubuntu in parallel.

**Via PR label:** add the `release-smoke` label to an open pull request.
The workflow will pick it up automatically and pack from the PR head.

**Where to look at artifacts:** GitHub Actions → the workflow run page →
**Artifacts** section. Retention is 7 days. Names:

- `gitbor-Windows-unpacked` — `win-unpacked/` from `electron-builder --win --dir`.
- `gitbor-macOS-unpacked` — `mac-arm64/GitBor.app` (or `mac/` on x64).
- `gitbor-Linux-unpacked` — `linux-unpacked/`.

**What to verify after download:** each archive unpacks without errors
and contains the GitBor binary (`gitbor.exe` / `GitBor.app/Contents/MacOS/GitBor`
/ `gitbor`). Launch is **not** part of the smoke (no UI runtime in CI
runners), only the packaging pipeline is validated.

## User data locations

Where the installed app reads/writes data on the user's machine. Useful
for support, backups, and uninstall cleanup.

`<userData>` resolves to (Electron `app.getPath('userData')`):

- **Windows**: `%APPDATA%\GitBor\` (e.g. `C:\Users\<name>\AppData\Roaming\GitBor\`)
- **macOS**: `~/Library/Application Support/GitBor/`
- **Linux**: `~/.config/GitBor/`

Files written by the main process:

| Path | Owner | Content |
|------|-------|---------|
| `<userData>/ai-config.json` | `AiConfigStore` | AI provider config; API keys / Qwen token encrypted via Electron `safeStorage` (`enc:` prefix), fallback `plain:` if key store unavailable. |
| `<userData>/logs/YYYY-MM-DD.log` | `Logger` | File log — opened only at non-`silent` level. In a packaged build the level defaults to `silent` (no file written) unless `GITBOR_LOG_LEVEL=info|debug|...` is set. |
| `<userData>/graphCache/` | `GraphCache` | Cached commit graph layouts per repo. |
| `<userData>/stats-cache/` | `AuthorStatsCache` | Cached per-author code stats. |

In-repo state:

| Path | Owner | Content |
|------|-------|---------|
| `<repo>/.git/GitBor-journal.json` | `OperationJournal` | WAL journal of in-progress destructive operations (begin/complete/fail). |

Renderer-side state lives in Chromium `localStorage` (per Electron
session, under `<userData>/Local Storage/`). Key prefixes:

- `sg-theme`, `sg-lang` — current theme / UI language.
- `sg-layout:*` — split-pane sizes (e.g. `sg-layout:changes-file-list-width:<repo>`,
  `sg-layout:commits-graph-height:<repo>`, `sg-layout:commits-detail-width:<repo>`).
- `sg-sidebar-sections`, `sg-branch-folders:<repo>[:<remote>]` — sidebar
  section open state and branch-tree expand state.
- `sg-recent-repos`, `sg-open-repos`, `sg-last-active-repo` — recent /
  open / active repository lists (restored on next launch).
- `gitbor.log` — opt-in debug flag for the renderer logger.

**Clean uninstall** (the NSIS uninstaller does NOT remove these): delete
the `GitBor` folder under the path above. On Windows, also clear
`HKCU\Software\GitBor` if you set up anything via NSIS scripts (not
currently used).

## Distribution & auto-updates

### Where to publish releases

`electron-builder` produces `release/` with installers, blockmaps, and
`latest.yml` / `latest-mac.yml` / `latest-linux.yml`. These metadata
files are what an auto-updater would consume.

Recommended targets:

- **GitHub Releases** — simplest. Set `build.publish` in `package.json`
  to `{"provider": "github", "owner": "...", "repo": "..."}` and run
  `electron-builder --publish always` (needs `GH_TOKEN` env). `latest.yml`
  is uploaded automatically alongside the binaries.
- **Generic HTTP / S3 / CDN** — use `{"provider": "generic", "url":
  "https://your-cdn/gitbor/"}`. Upload the contents of `release/`
  (installers + `latest*.yml` + `*.blockmap`) to that URL prefix
  manually or via CI.

Until `build.publish` is configured, the `latest.yml` files in
`release/` are unused — they only become meaningful when the same URL
is reachable from the running app's auto-updater.

### Auto-updates (NOT enabled by default)

GitBor ships **without** `electron-updater` wired into `main.ts`.
Generated `latest.yml` is ignored at runtime; users have to download
new installers manually.

To enable:

1. `npm install electron-updater`.
2. Add `build.publish` in `package.json` (see above).
3. In `src/main/main.ts`, after `app.whenReady`:

   ```ts
   import { autoUpdater } from 'electron-updater';
   autoUpdater.logger = mainLogger; // already exists
   autoUpdater.checkForUpdatesAndNotify();
   ```

4. Rebuild and publish via `electron-builder --publish always` so
   `latest.yml` reflects the new version.

Platform notes:

- **Windows**: NSIS target supports auto-updates (delta updates via
  `.blockmap`); portable target does NOT.
- **macOS**: requires Developer ID signing AND notarization — both are
  currently off (`mac.identity: null`, `mac.notarize: false`).
- **Linux**: AppImage supports updates; `.deb` does not — distribute
  `.deb` via your apt repo.

## Known limitations

- macOS notarization requires Apple Developer ID — not configured.
- Auto-updates not wired (`electron-updater` not installed, no
  `build.publish`). See "Distribution & auto-updates" above to enable.
- Real product icons not yet designed; placeholder icons are
  geometric/auto-generated. See `scripts/build-icons.mjs`.
- Bundled Git for Windows: not included; users need to install Git separately.
- Snap/Flatpak Linux targets: not configured.

## Troubleshooting

**`electron-builder` fails with "Cannot find module 'png2icons'"** —
run `npm install` first; `png2icons` and `pngjs` are dev-deps used by
`build:icons`.

**macOS DMG won't open ("damaged")** — the build is ad-hoc signed.
Right-click → Open or `xattr -d com.apple.quarantine GitBor.app` to
override Gatekeeper for development.

**Linux AppImage fails to launch** — ensure `chmod +x` on the AppImage
file. On Ubuntu 24.04+ AppImage requires `libfuse2`:
`sudo apt install libfuse2`.

**Windows installer fails on long paths** — installer attempts to set
`LongPathsEnabled` registry; if it didn't take effect, run as admin or
manually set `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`.
