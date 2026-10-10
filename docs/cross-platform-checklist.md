# Cross-platform чек-лист (GitBor)

> English version: [docs/en/cross-platform-checklist.md](en/cross-platform-checklist.md)

> Live-документ актуального состояния. Здесь — только открытые задачи и то, что
> нужно проверить руками после первого запуска на macOS / Linux.

## Открытые пункты по платформам

| Платформа | Задача | Приоритет |
|---|---|---|
| macOS | Реальная нотаризация (`mac.notarize: true` + Apple Developer ID + `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`) | низкий — требует учётки Apple Developer |
| macOS | Реальный дизайн-логотип вместо placeholder из `scripts/build-icons.mjs` | средний — нужен ассет от дизайнера |
| macOS | Light/dark variant иконки для menu bar tray | низкий |
| Linux | Snap / Flatpak target в `package.json/build.linux.target` | средний |
| Linux | Реальный дизайн-логотип `resources/icon.png` (см. выше) | средний |
| Windows | Microsoft Store Tile icons | низкий — только для Store-публикации |
| Cross | Bundled portable git для Windows (MinGit ~30 МБ + Settings UI выбора git + GPL-2 attribution в About) | низкий — продуктовое решение, не техническое |

## Что вне scope

- **Apple Developer ID** — реальная подпись + нотаризация требует платной учётки, не настраиваем. `mac.identity: null` + `mac.notarize: false` явно.
- **Bundled git** — GitBor использует системный git (`PATH`-lookup в `GitExecutor`). На Windows нужен Git for Windows, на macOS — Xcode CLT или brew, на Linux — пакет менеджера. `checkGitAvailable` + `showGitNotFoundMessage` ловят отсутствие git на старте.
- **Cross-build из CI** — релизы macOS / Linux собираются на соответствующих runner'ах. Подписанный macOS-билд с Windows-runner невозможен (нужен `codesign` из Xcode).

## Что проверить вручную (Mac / Linux runtime — следующий стрим)

1. Запуск `npm run build && npm start` на macOS Ventura+ / Sonoma+.
2. Запуск на Ubuntu 22.04 / 24.04 (X11 и Wayland-сессии) и Fedora (Wayland по умолчанию).
3. Открыть репо с non-ASCII путями (русские / японские / китайские).
4. Открыть репо с symlink'ами наружу — проверить поведение `safePath`.
5. `electron-builder --mac --dir` после первого запуска `npm run build:icons` (`icon.icns` генерируется placeholder'ом).
6. `electron-builder --linux --dir` — то же для `icon.png` + проверить наличие `.deb`-метаданных.
7. `FileWatcher` на репо с >1000 файлов в верхнем уровне на macOS (FSEvents → `fs.watch` fallback в chokidar 4).
8. На macOS — поведение `mkdirSync({ mode: 0o700 })` для `~/.ssh/` (ACL применяется как ожидается).
9. На Linux — `safeStorage` через `secret-service`: проверить, что AI-секреты пишутся (а не фолбэк на `plain:`) при наличии KWallet / gnome-keyring.
