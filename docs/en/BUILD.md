> Русская версия: [docs/BUILD.md](../BUILD.md)

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

Output: `release/GitBor-X.Y.Z.dmg` (the build machine's architecture). CI builds
both — `GitBor-X.Y.Z-x64.dmg` (Intel) and `GitBor-X.Y.Z-arm64.dmg` (Apple
Silicon). Locally, both architectures: `npx electron-builder --mac --x64 --arm64`
(the name is set the same way as in `release.yml`, via `--config.dmg.artifactName`).

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
- `.github/workflows/release.yml` — builds installers for all platforms and
  variants; on a `vX.Y.Z` tag publishes them to a GitHub Release (see
  "Releases and auto-update" below).
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
- `sg-layout:*` — panel sizes (`sidebar-width`, `changes-file-list-width:<repo>`,
  `changes-staged-height:<repo>`, `commits-graph-height:<repo>`, `commits-detail-width:<repo>`).
- `sg-sidebar-sections`, `sg-branch-folders:<repo>[:<remote>]` — sidebar
  section and branch-tree expansion state.
- `sg-branch-pinned`, `sg-branch-hidden`, `sg-graph-solo`, `sg-branch-notes`
  (with a `:<repo>` suffix) — pinned / hidden branches, the graph branch filter,
  branch notes.
- `sg-recent-repos`, `sg-open-repos`, `sg-last-active-repo` — recent /
  open / active repo lists (restored on the next launch).
- `sg-clone-base-dir`, `sg-init-base-dir` — last folders for clone / init.
- `sg-gitignore-banner-dismissed:<repo>` — dismissed `.gitignore` hint.
- `gitbor.commitDraft:<repo>` — unsaved commit message draft (drafts under the
  old `skycode.commitDraft` key are migrated automatically).
- `gitbor.stash.includeUntracked` — last "Include new files" choice in the "Stash" dialog.
- `gitbor.graph.soloMode` — branch filter mode: "Own commits" / "Full history".
- `gitbor.log` — opt-in flag for renderer debug logs.

**Clean uninstall** (the NSIS uninstaller does NOT clean this): delete the
`GitBor` folder at the path above. On Windows — also `HKCU\Software\GitBor`
if anything was written there via NSIS scripts (not used at the moment).

## Releases and auto-update

### Shipping a version

Releases are built by GitHub Actions (`.github/workflows/release.yml`) — free for a public repository.

1. Bump `version` in `package.json` **and** `src/renderer/package.json` (they must match).
2. Write the change list in `build/release-notes.md` — `<!-- ru -->` and `<!-- en -->` blocks, one short line per item. Both the GitHub Release text and the "what's new" list in the update dialog come from this file.
3. Commit, tag `vX.Y.Z` and push the tag (`git tag v0.1.23 && git push origin v0.1.23`).
4. The workflow builds 6 variants (Windows / Linux / macOS × regular / No AI; macOS for Intel and Apple Silicon) and attaches to the GitHub Release:
   - installers (`*.exe`, `*.dmg`, `*.AppImage`, `*.deb`, `*.rpm`) and `*.blockmap` for differential updates;
   - update channel files: `latest.yml` / `latest-mac.yml` / `latest-linux.yml` for the regular build and `noai.yml` / `noai-mac.yml` / `noai-linux.yml` for No AI.

A manual run (Actions → Release → Run workflow) only builds artifacts without publishing — handy to check that everything builds.

Builds are not signed: Windows shows SmartScreen, macOS shows a Gatekeeper warning.

### How auto-update works

`electron-updater` in `src/main/AppUpdater.ts`; source and policy in `src/main/updateFlavor.ts`:

- **Where from:** GitHub Releases of `RuslanSinkevich/gitbor`. The regular build reads the `latest*.yml` channel, No AI reads `noai*.yml`; an installer of the other variant is never accepted.
- **When:** ~8 s after an installed build starts, background download, then a "Restart and install" dialog with the list of changes.
- **"What's new" list:** the `releaseNotes` field of the yml, which electron-builder fills from `build/release-notes.md` (`src/main/releaseNotes.ts`). Without that field a fallback request to the website is used.
- **Disabled:** in dev (`npm run dev`), in the portable build, with `GITBOR_SKIP_UPDATE_CHECK=1`.
- **Manual check:** About → "Check for updates".
- **Fallback source:** `GITBOR_UPDATE_BASE_URL=<url>` switches to a generic source (e.g. a bucket) laid out as `<url>/win/`, `<url>/win/no_ai/`, `<url>/mac/`, `<url>/linux/` and so on.

**After a release:** run the previous installed version — after ~8 s the log (`<userData>/logs/YYYY-MM-DD.log` with `GITBOR_LOG_LEVEL=debug`) shows `appUpdater: … available X.Y.Z`, then the restart dialog.

**Degradation:** no network, a release without the needed yml, or a GitHub error — the app keeps working, the log shows `appUpdater: … check failed`, a manual check shows "Could not check for updates".

**Upgrading from old versions:** versions released before the move to GitHub Releases only check the old source — update them once with an installer by hand.

### Platform limits

- **Windows:** only the NSIS installer auto-updates; the portable build does not.
- **macOS:** without a Developer ID signature and notarization auto-update is unreliable (`mac.identity: null`, `mac.notarize: false`).
- **Linux:** AppImage updates; `.deb` / `.rpm` do not (only via your own apt / yum repository).

## Known limitations

- macOS notarization requires an Apple Developer ID — not configured.
- Auto-update: GitHub Releases (see "Releases and auto-update" above); unsigned
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
