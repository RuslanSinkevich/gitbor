> Русская версия: [docs/ru/BUILD.md](ru/BUILD.md)

# Building GitBor

Cross-platform desktop Git client. This document describes how to build
distributable artifacts on each platform.

## Prerequisites

- Node.js 22+
- npm 10+
- Git (any recent version)

Platform-specific:

- **Windows**: nothing extra; PortableGit is recommended for the runtime
  but not required for the build.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`) for
  `git` and code-signing utilities. For DMG: macOS Sonoma+.
- **Linux**: `fakeroot` and `dpkg` for `.deb`; `rpmbuild` for `.rpm`;
  AppImage builds without extra system packages on Ubuntu 22.04+.

## Build (without packaging)

Standard build (no packaging):

```bash
npm install
cd src/renderer && npm install && cd ../..
npm run build
```

This produces `dist/main/`, `dist/preload/`, `dist/renderer/`.

## Packaging

Generate placeholder icons (once, before the first packaging run):

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
(names without spaces — they match `latest.yml` for auto-update). The NSIS
installer optionally sets the Win10 `LongPathsEnabled` registry key
(requires admin rights during installation) — see `build/installer.nsh`.

Code signing: not configured. Add `CSC_LINK` (path to a .pfx) and
`CSC_KEY_PASSWORD` to the env to enable it.

### macOS (.dmg)

```bash
npm run dist:mac
```

Output: `release/GitBor-X.Y.Z.dmg`.

Code signing: ad-hoc (`mac.identity: null`). For Developer ID signing,
unset `CSC_IDENTITY_AUTO_DISCOVERY: false` in CI and provide:

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (notarization)
- Or `CSC_LINK` + `CSC_KEY_PASSWORD` for an explicit certificate.

`mac.notarize: false` is the default; switch it to `true` and add the
Apple ID env vars to enable notarization.

Hardened runtime is enabled. Entitlements live in `build/entitlements.mac.plist`.

### Linux (AppImage + .deb + .rpm)

```bash
npm run dist:linux
```

Output: `release/GitBor-X.Y.Z.AppImage`, `release/gitbor_X.Y.Z_amd64.deb`,
`release/gitbor-X.Y.Z.x86_64.rpm`.

The `.deb` / `.rpm` packages include maintainer/synopsis/desktop entry.
AppImage runs on most glibc-based distros (Ubuntu 22.04+, Fedora 38+,
Debian 12+).

### No-AI build variants

For environments where the AI features must be stripped out, the
`dist:*:no-ai` scripts build with `GITBOR_AI=0` and a separate
appId/productName/publish URL:

```bash
npm run dist:win:no-ai
npm run dist:mac:no-ai
npm run dist:linux:no-ai
npm run dist:win:all      # both standard and no-ai Windows variants
```

## CI

- `.github/workflows/ci.yml` — lint + tsc + test + build on
  Windows/macOS/Ubuntu (matrix). No packaging.
- `.github/workflows/pr.yml` — Windows e2e via Playwright.
- `.github/workflows/release-pack.yml` — manual `workflow_dispatch` for
  smoke packaging on all 3 platforms via `electron-builder --dir`.
  Artifacts are uploaded for inspection. Does NOT sign or notarize.

### Running the release-pack smoke locally

The `release-pack.yml` workflow runs on-demand only — there is no schedule.
Two ways to trigger it:

**Via GitHub CLI (any branch):**

```bash
gh workflow run "Release Pack Smoke" --ref main
```

Replace `main` with the branch you need. The workflow runs Windows / macOS
/ Ubuntu in parallel.

**Via PR label:** add the `release-smoke` label to an open pull request —
the workflow picks it up and packages from the PR HEAD.

**Where to find artifacts:** GitHub Actions → the run page → the
**Artifacts** section. Retention is 7 days. Names:

- `gitbor-Windows-unpacked` — `win-unpacked/` from `electron-builder --win --dir`.
- `gitbor-macOS-unpacked` — `mac-arm64/GitBor.app` (or `mac/` on x64).
- `gitbor-Linux-unpacked` — `linux-unpacked/`.

**What to check after downloading:** each archive extracts without errors
and contains the GitBor binary (`gitbor.exe` /
`GitBor.app/Contents/MacOS/GitBor` / `gitbor`). Launching the UI is not
part of the smoke test (CI runners have no display) — only the packaging
pipeline is validated.

## Where user data is stored

Where the installed app reads/writes data on the user's machine — handy
for support, backups, and clean uninstalls.

`<userData>` (Electron `app.getPath('userData')`) resolves to:

- **Windows**: `%APPDATA%\GitBor\` (e.g. `C:\Users\<name>\AppData\Roaming\GitBor\`)
- **macOS**: `~/Library/Application Support/GitBor/`
- **Linux**: `~/.config/GitBor/`

Files written by the main process:

| Path | Writer | Contents |
|------|--------|----------|
| `<userData>/ai-config.json` | `AiConfigStore` | AI provider config; API keys / Qwen token encrypted via Electron `safeStorage` (`enc:` prefix), fallback `plain:` when the key store is unavailable. |
| `<userData>/logs/YYYY-MM-DD.log` | `Logger` | File log — opened only at a non-`silent` level. In a packaged build the default is `silent` (nothing written); enable via `GITBOR_LOG_LEVEL=info|debug|...`. |
| `<userData>/graphCache/` | `GraphCache` | Cached commit-graph layouts per repo. |
| `<userData>/stats-cache/` | `AuthorStatsCache` | Cached per-author stats. |

State inside the repository:

| Path | Writer | Contents |
|------|--------|----------|
| `<repo>/.git/GitBor-journal.json` | `OperationJournal` | WAL journal of in-flight destructive operations (begin/complete/fail). |

Renderer state lives in Chromium `localStorage` (per Electron session,
physically under `<userData>/Local Storage/`). Key prefixes:

- `sg-theme`, `sg-lang` — current UI theme / language.
- `sg-layout:*` — split-pane sizes (e.g. `sg-layout:changes-file-list-width:<repo>`,
  `sg-layout:commits-graph-height:<repo>`, `sg-layout:commits-detail-width:<repo>`).
- `sg-sidebar-sections`, `sg-branch-folders:<repo>[:<remote>]` — sidebar
  section and branch-tree expansion state.
- `sg-recent-repos`, `sg-open-repos`, `sg-last-active-repo` — recent /
  open / active repo lists (restored on the next launch).
- `gitbor.log` — opt-in flag for renderer debug logs.

**Clean uninstall** (the NSIS uninstaller does NOT clean this): delete the
`GitBor` folder at the path above. On Windows — also `HKCU\Software\GitBor`
if anything was written there via NSIS scripts (not used at the moment).

## Distribution and auto-updates

### Where to publish releases

`electron-builder` produces `release/` with installers, blockmaps, and
`latest.yml` / `latest-mac.yml` / `latest-linux.yml`. These metadata files
are read by the auto-updater.

Recommended targets:

- **GitHub Releases** — simplest. Set `build.publish` in `package.json`:
  `{"provider": "github", "owner": "...", "repo": "..."}` and run
  `electron-builder --publish always` (needs `GH_TOKEN` in the env).
  `latest.yml` is uploaded automatically with the binaries.
- **Generic HTTP / S3 / CDN** — `{"provider": "generic", "url":
  "https://your-cdn/gitbor/"}`. Upload the contents of `release/`
  (installers + `latest*.yml` + `*.blockmap`) under that prefix manually
  or via CI.

### Auto-updates

Wired via `electron-updater` (`src/main/AppUpdater.ts`):

- **URL:** `build.publish` → `https://storage.yandexcloud.net/gitbor/stable/win/`
- **When:** ~8 s after start (packaged NSIS), background download
- **Disabled in:** dev (`npm run dev`), portable `.exe`, `GITBOR_SKIP_UPDATE_CHECK=1`
- **Manual check:** About → "Check for updates"

### Release cycle (Windows NSIS)

1. Bump `version` in `package.json` AND in `src/renderer/package.json` (must match).
2. `npm run dist:win` — builds `release/`:
   - `GitBor-Setup-X.Y.Z.exe` (NSIS, required)
   - `GitBor-Setup-X.Y.Z.exe.blockmap` (delta updates, required)
   - `latest.yml` (auto-updater metadata, required)
   - `GitBor-Portable-X.Y.Z.exe` (optional, not part of auto-update)
3. Upload the **3 files** (`.exe`, `.exe.blockmap`, `latest.yml`) to the
   bucket under the `gitbor/stable/win/` prefix — do NOT drop them in the
   bucket root or rename `latest.yml`.
4. Verify: `https://storage.yandexcloud.net/gitbor/stable/win/latest.yml`
   opens without auth and parses as YAML with `version`, `path`, `sha512`.
5. Launch the previously installed version → after ~8 s the log
   (`%APPDATA%\GitBor\logs\YYYY-MM-DD.log` at `GITBOR_LOG_LEVEL=debug`)
   shows `appUpdater: ... update available X.Y.Z`, the background download,
   and a "Restart" prompt.

**Bucket degradation:** 404 / empty `latest.yml` / no network — the app
keeps working, the log shows `appUpdater: ... check failed: ...`, and a
manual check from About shows a localized "couldn't check".

**First version with the updater → next one:** users on the old version
(without the updater) won't pick it up automatically — a one-time direct
installer update is needed. From the next version onward it's automatic.

- **Windows**: the NSIS target supports auto-updates (delta updates via
  `.blockmap`); portable does NOT.
- **macOS**: requires a Developer ID signature AND notarization — both are
  currently disabled (`mac.identity: null`, `mac.notarize: false`).
- **Linux**: AppImage supports updates; `.deb` / `.rpm` do not (distribute
  via your own apt/yum repository).

## Known limitations

- macOS notarization requires an Apple Developer ID — not configured.
- Auto-updates: NSIS + Yandex bucket (see "Auto-updates" above). Unsigned
  macOS builds are not production-ready for auto-update.
- Real product icons are not drawn yet; placeholder icons are
  geometric/auto-generated. See `scripts/build-icons.mjs`.
- Bundled Git for Windows: not included; users need to install Git
  separately.
- Snap/Flatpak Linux targets: not configured.

## Troubleshooting

**`electron-builder` fails with "Cannot find module 'png2icons'"** — run
`npm install` first; `png2icons` and `pngjs` are dev-deps used by
`build:icons`.

**macOS DMG won't open ("damaged")** — the build is ad-hoc signed.
Right-click → Open or `xattr -d com.apple.quarantine GitBor.app` to
bypass Gatekeeper for development.

**Linux AppImage won't launch** — make sure the AppImage file has
`chmod +x`. On Ubuntu 24.04+ AppImage requires `libfuse2`:
`sudo apt install libfuse2`.

**Windows installer fails on long paths** — the installer tries to set
the `LongPathsEnabled` registry key; if it didn't apply, run as
administrator or set
`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`
manually.
