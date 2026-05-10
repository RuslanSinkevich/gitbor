# Сборка SkyFork

Кроссплатформенный десктопный Git-клиент. Этот документ описывает, как
собирать дистрибутивные артефакты на каждой платформе.

## Требования

- Node.js 22+
- npm 10+
- Git (любая свежая версия)

Платформо-зависимое:

- **Windows**: ничего дополнительно; PortableGit рекомендуется для
  рантайма, но не требуется для сборки.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`) для
  `git` и утилит подписи кода. Для DMG: macOS Sonoma+.
- **Linux**: `fakeroot` и `dpkg` для `.deb`; AppImage собирается без
  дополнительных системных пакетов на Ubuntu 22.04+.

## Сборка (без пакетинга)

Стандартная сборка (без упаковки):

```bash
npm install
cd src/renderer && npm install && cd ../..
npm run build
```

Это создаёт `dist/main/`, `dist/preload/`, `dist/renderer/`.

## Пакетинг

Сгенерировать placeholder-иконки (один раз, перед первым пакетингом):

```bash
npm run build:icons
```

Это создаёт `resources/icon.{ico,icns,png}` из шаблона. Они находятся
в gitignore — пересобирай локально по мере необходимости.

### Windows (.exe NSIS installer + portable)

```bash
npm run dist:win
```

Вывод: `release/SkyFork Setup X.Y.Z.exe`, `release/SkyFork X.Y.Z.exe`
(portable). NSIS-инсталлятор опционально включает реестровый ключ
Win10 LongPathsEnabled (требует прав администратора во время установки)
— см. `build/installer.nsh`.

Подпись кода: не настроена. Добавь `CSC_LINK` (путь к .pfx) и
`CSC_KEY_PASSWORD` в env, чтобы включить.

### macOS (.dmg)

```bash
npm run dist:mac
```

Вывод: `release/SkyFork-X.Y.Z.dmg`.

Подпись кода: ad-hoc (`mac.identity: null`). Для подписи Developer ID
сними `CSC_IDENTITY_AUTO_DISCOVERY: false` в CI и предоставь:

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (нотаризация)
- Или `CSC_LINK` + `CSC_KEY_PASSWORD` для явного сертификата.

`mac.notarize: false` — значение по умолчанию; переключи на `true` и
добавь env Apple ID, чтобы включить нотаризацию.

Hardened runtime включён. Entitlements в `build/entitlements.mac.plist`.

### Linux (AppImage + .deb)

```bash
npm run dist:linux
```

Вывод: `release/SkyFork-X.Y.Z.AppImage`, `release/skyfork_X.Y.Z_amd64.deb`.

`.deb` включает maintainer/synopsis/desktop entry. AppImage запускается
на большинстве glibc-based дистрибутивов (Ubuntu 22.04+, Fedora 38+,
Debian 12+).

## CI

- `.github/workflows/ci.yml` — lint + tsc + test + build на
  Windows/macOS/Ubuntu (matrix). Без пакетинга.
- `.github/workflows/pr.yml` — Windows e2e через Playwright.
- `.github/workflows/release-pack.yml` — ручной `workflow_dispatch` для
  smoke-пакетинга на всех 3 платформах через `electron-builder --dir`.
  Артефакты загружаются для инспекции. НЕ подписывает и не нотаризует.

## Известные ограничения

- Нотаризация macOS требует Apple Developer ID — не настроена.
- Реальные продуктовые иконки ещё не нарисованы; placeholder-иконки
  геометрические/авто-сгенерированные. См. `scripts/build-icons.mjs`.
- Bundled Git для Windows: не включён; пользователям нужно установить
  Git отдельно.
- Snap/Flatpak Linux targets: не настроены.

## Диагностика проблем

**`electron-builder` падает с "Cannot find module 'png2icons'"** —
сначала запусти `npm install`; `png2icons` и `pngjs` — это dev-deps,
используемые `build:icons`.

**macOS DMG не открывается ("damaged")** — сборка подписана ad-hoc.
Правый клик → Open или `xattr -d com.apple.quarantine SkyFork.app`,
чтобы обойти Gatekeeper для разработки.

**Linux AppImage не запускается** — убедись, что у файла AppImage есть
`chmod +x`. На Ubuntu 24.04+ AppImage требует `libfuse2`:
`sudo apt install libfuse2`.

**Windows installer падает на длинных путях** — инсталлятор пытается
выставить реестровый ключ `LongPathsEnabled`; если он не применился,
запусти от имени администратора или вручную установи
`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`.
