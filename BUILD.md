# Building SkyFork

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

Output: `release/SkyFork Setup X.Y.Z.exe`, `release/SkyFork X.Y.Z.exe`
(portable). NSIS installer optionally enables Win10 LongPathsEnabled
registry (requires admin during install) — see `build/installer.nsh`.

Code signing: not configured. Add `CSC_LINK` (path to .pfx) and
`CSC_KEY_PASSWORD` to env to enable.

### macOS (.dmg)

```bash
npm run dist:mac
```

Output: `release/SkyFork-X.Y.Z.dmg`.

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

Output: `release/SkyFork-X.Y.Z.AppImage`, `release/skyfork_X.Y.Z_amd64.deb`.

`.deb` includes maintainer/synopsis/desktop entry. AppImage runs on most
glibc-based distros (Ubuntu 22.04+, Fedora 38+, Debian 12+).

## CI

- `.github/workflows/ci.yml` — lint + tsc + test + build on
  Windows/macOS/Ubuntu (matrix). No packaging.
- `.github/workflows/pr.yml` — Windows e2e via Playwright.
- `.github/workflows/release-pack.yml` — manual `workflow_dispatch` for
  smoke-packaging on all 3 platforms via `electron-builder --dir`.
  Artifacts uploaded for inspection. Does NOT sign or notarize.

## Known limitations

- macOS notarization requires Apple Developer ID — not configured.
- Real product icons not yet designed; placeholder icons are
  geometric/auto-generated. See `scripts/build-icons.mjs`.
- Bundled Git for Windows: not included; users need to install Git separately.
- Snap/Flatpak Linux targets: not configured.

## Troubleshooting

**`electron-builder` fails with "Cannot find module 'png2icons'"** —
run `npm install` first; `png2icons` and `pngjs` are dev-deps used by
`build:icons`.

**macOS DMG won't open ("damaged")** — the build is ad-hoc signed.
Right-click → Open or `xattr -d com.apple.quarantine SkyFork.app` to
override Gatekeeper for development.

**Linux AppImage fails to launch** — ensure `chmod +x` on the AppImage
file. On Ubuntu 24.04+ AppImage requires `libfuse2`:
`sudo apt install libfuse2`.

**Windows installer fails on long paths** — installer attempts to set
`LongPathsEnabled` registry; if it didn't take effect, run as admin or
manually set `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`.
