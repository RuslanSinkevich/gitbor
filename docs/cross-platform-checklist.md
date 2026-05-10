# Cross-platform чек-лист (Skyfork)

> Дата создания: 2026-05-09. Обновлено: 2026-05-10 (стрим 4 — параллельный).
> Стрим аудита для определения «что ломается, если завтра запустить на Mac/Linux».
> Runtime-валидация на Mac/Linux вне скоупа этого стрима — здесь только
> статический аудит и точечные фиксы, проверяемые на Windows.

## 1. Ветви по `process.platform`

| Файл | Ветви | Полная тройка? | Заметки |
|---|---|---|---|
| `src/main/main.ts:279` | `!== 'darwin'` | da (стандарт macOS quit-on-window-close) | OK |
| `src/core/utils/repoPathGuard.ts` | win32 / else (POSIX) + `isCaseInsensitiveFs()` | **Закрыто в стриме 4 (2026-05-10):** `/Applications` добавлен в `posixSystemRoots` и `prohibited`, POSIX-ветка делает case-insensitive сравнение на darwin, `path.win32`/`path.posix.resolve` для корректной работы под мокнутый `process.platform`. Тесты — `tests/utils/repoPathGuard.test.ts` (+5 darwin/linux кейсов). |
| `src/core/utils/pathSecurity.ts` | `isCaseInsensitiveFs() = win32 \|\| darwin` | linux = case-sensitive | **Закрыто в стриме 3 (2026-05-09):** `process.platform` читается при каждом вызове, ветка case-insensitive расширена на `darwin`. Тесты с моком platform — `tests/utils/pathSecurity.test.ts`. |
| `src/core/bridge/ipc/handlersRepoExtras.ts:205,212` | win32 / darwin / else | OK, явная тройка | OK |
| `src/core/commands/readCommands.ts:86` | `nullDev = NUL : /dev/null` | Linux/macOS общий `/dev/null`, OK | OK |
| `src/preload/index.ts:30` | `process.platform` экспортируется в renderer | renderer использует для ветки UI (если есть) | OK |

**Вывод (после стрима 4):** грубых дыр в платформенных ветвях нет. `/Applications` добавлен; case-insensitive сравнение применяется на darwin/win32, на linux — case-sensitive (default ext4).

## 2. Path-сепараторы (`\\` vs `/` vs `path.sep`)

| Случай | Где | Безопасно? |
|---|---|---|
| Конвертация POSIX-пути из git в native | `src/main/main.ts:185` `replace(/\//g, path.sep)` | OK — git выдаёт `/`, конвертим в `\` для Windows. На macOS/Linux `path.sep` тоже `/`, no-op. |
| `safePath`/`isSafeFilename` через `sep` из `path` | `src/core/utils/pathSecurity.ts` | OK — берём `path.sep`, не хардкодим. |
| Парсинг file paths из git output (always `/`) | `src/core/git/SubmoduleParser.ts:20`, `src/renderer/.../fileTreeModel.ts:18`, `BranchTree.tsx:24`, `CommitDetails.tsx:20`, `FileTree.tsx:57` | OK — git всегда выдаёт `/`, даже на Windows; split на `/` корректен. |

**Хардкод-сепараторов в I/O коде нет.** Все file-IO идёт через `path.join`/`path.resolve`.

## 3. File permissions (`chmod`, `mkdirSync mode`)

| Место | Параметр | Поведение на Windows |
|---|---|---|
| `src/core/ssh/SshKeyManager.ts:129` | `mkdirSync(sshDir, { mode: 0o700 })` | На Windows `mode` игнорируется (NTFS использует ACL). Не падает, не предупреждает. SSH ключи в `~/.ssh` всё равно защищены ACL по умолчанию (юзер-only). **OK.** |
| `src/core/git/HooksManager.ts:77` | `await chmod(enabledPath, 0o755).catch(() => {})` | На Windows chmod no-op, исключение проглатывается. Хуки на Win запускаются git'ом через bash из Git for Windows — execute-бит не нужен. **OK.** |

**Не делаем:** ручной выставки ACL через `icacls` — стандартное `mkdirSync` на Windows уже ограничивает наследование разрешений до текущего юзера. Излишне.

## 4. macOS: code signing, notarization, hardened runtime

| Аспект | Текущее состояние |
|---|---|
| `mac.target` в `package.json` | `[dmg]` — OK, dmg производится |
| `mac.icon` | **Закрыто в стриме 4:** `resources/icon.icns` генерится `npm run build:icons` (placeholder через png2icons), путь возвращён в `package.json`. См. §11. |
| `mac.category` | `public.app-category.developer-tools` — OK |
| `mac.hardenedRuntime` | **Закрыто в стриме 3:** `true`. |
| `mac.entitlements` / `mac.entitlementsInherit` | **Закрыто в стриме 3:** `build/entitlements.mac.plist` (allow-jit, allow-unsigned-executable-memory, disable-library-validation, inherit). |
| `mac.notarize` | `false` — реальная нотаризация требует Apple Developer ID, не настроено. |
| Подпись (`mac.identity`) | **Закрыто в стриме 4:** `null` явно (ad-hoc). Без этого electron-builder в CI без env-переменных мог зависать на интерактивном prompt. Для Developer ID — flip + `CSC_LINK`/`APPLE_ID`. |

**Что нужно перед первым DMG:**
1. Положить `resources/icon.icns` (1024×1024 PNG → `iconutil -c icns`).
2. Создать `build/entitlements.mac.plist`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>com.apple.security.cs.allow-jit</key><true/>
     <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
     <key>com.apple.security.cs.disable-library-validation</key><true/>
   </dict></plist>
   ```
3. Добавить в `package.json`:
   ```json
   "mac": {
     "hardenedRuntime": true,
     "entitlements": "build/entitlements.mac.plist",
     "entitlementsInherit": "build/entitlements.mac.plist",
     "gatekeeperAssess": false,
     "notarize": false
   }
   ```
4. Для notarize — переменные окружения `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` (или API key) и `"notarize": { "teamId": "..." }`.

**В этом стриме не делаем** — нет Mac-машины для подписи.

## 5. Windows: long-paths, file locking, core.longpaths

| Аспект | Состояние |
|---|---|
| Long paths (>260) | Node 22+ использует `\\?\`-префикс автоматически в `fs.realpathSync.native`, `fs.openSync`, etc. **OK для приложения.** Но git без `core.longpaths=true` падает на репо с глубокими путями. SkyFork эту настройку не ставит сам. |
| File locking (`.git/index.lock`) | Уже обработано в `src/core/safety/RecoveryManager.ts` — есть проверка stale-локов на старте. |
| NSIS installer + LongPathsEnabled | **Закрыто в стриме 4:** `build/installer.nsh` с `customInstall` macro выставляет `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1` для Win10 1607+ при инсталляции. Подключено через `nsis.include`. |
| Antivirus задержка fs-операций | Не контролируется приложением; chokidar уже использует `awaitWriteFinish` для git-папки. |
| `windowsHide: true` в spawn'ах git | Уже стоит во всех вызовах `GitExecutor`. Терминал-окна git не мелькают. **OK.** |
| `core.quotePath=false` | Уже передаётся как `git -c core.quotePath=false ...` в каждом вызове — non-ASCII пути не выводятся в `\nnn`-эскейпах. **OK.** |

**Кандидат на следующий стрим:** автоматически предлагать `git config --global core.longpaths true` если SkyFork обнаружил репо с длинным путём и git упал.

## 6. Linux: Wayland vs X11, inotify limits, AppImage vs deb vs flatpak

| Аспект | Состояние |
|---|---|
| Wayland | **Закрыто в стриме 3:** `app.commandLine.appendSwitch('ozone-platform-hint', 'auto')` добавлено в `src/main/main.ts` под guard'ом `process.platform === 'linux'`. |
| `inotify` watch limits | chokidar 4 на Linux использует `fs.watch` (рекурсивный с Node 20+). На больших worktree упирается в `fs.inotify.max_user_watches` (default 8192–65536). Уже есть hard-stop по `WORKTREE_TOPLEVEL_LIMIT=1000` в `FileWatcher.ts` — рандомные большие репо не валятся. **OK.** |
| `linux.target` | `[AppImage, deb]` — OK для Ubuntu/Debian + universal AppImage. Snap/flatpak не сделано. |
| `linux.icon` | **Закрыто в стриме 4:** `resources/icon.png` генерится placeholder'ом, путь в `package.json`. |
| `.deb` metadata | **Закрыто в стриме 4:** `linux.maintainer`, `linux.synopsis`, `linux.description`, `linux.desktop.entry` (Name/Categories/StartupWMClass/MimeType). |
| Rendering glitches на Wayland (transparent BG) | Возможны, но конкретные баги без runtime неизвестны. |

## 7. Bundled git (`resources/git/{platform}/git`)

| Платформа | Содержимое | Размер |
|---|---|---|
| `resources/` | `.gitkeep`, `.gitignore` (для иконок) | мало |

**Вывод:** git **не бандлится**. Используется системный (`PATH`-lookup в `GitExecutor`). На Windows — пользователь должен иметь Git for Windows; на macOS — Xcode CLT или brew git; на Linux — пакет менеджера.

`src/core/safety/RecoveryUI.ts:checkGitAvailable` + `showGitNotFoundMessage` (закрыто в стриме 4: i18n en/ru, кнопки Download/Quit, ранний `app.quit()` при Quit) обнаруживают отсутствие git и не дают мёртвому UI стартовать.

**Кандидат на следующий стрим (опционально):** бандлить portable git для Windows (Fork-style: MinGit ~30 МБ + Settings UI с переключением на системный git + GPL-2 attribution в About-диалоге). Технически готова треть инфраструктуры (`GitExecutor` параметризуется путём, `RecoveryUI` уже маршрутизирует error path). Решение продуктовое, не техническое.

## 8. Native modules (rebuild при cross-build)

В `package-lock.json` нашлись:
- `fsevents@2.3.3` — optional dep (macOS-only, transitive). chokidar 4 НЕ использует fsevents в watcher'ах (все платформы через `fs.watch` recursive). На Win/Linux fsevents просто не ставится — `npm i` skip без ошибок.
- `node-gyp@12.x` — для опциональной компиляции nodejs-native binding'ов. Никаких наших нативных модулей нет.

**electron-builder rebuild:** в `package.json/build` нет `npmRebuild: false` — значит, electron-builder вызывает `electron-rebuild` для каждого нативного бинарника при `electron-builder --win/--mac/--linux`. У нас нативных нет, шаг no-op.

**Cross-build (например, `--mac` с Windows-runner):** не работает для подписанных macOS-сборок (нужен codesign из Xcode). Линуксовый AppImage можно собрать на любой платформе. Win NSIS — на Win/Linux. **Реалистично:** PR-CI собирает `--win` на Windows, релизы для mac/linux собирать на соответствующих runners.

## 9. Найденные Windows-only баги — ИСПРАВЛЕНО

### 9.1 `repoPathGuard.ts` — захардкоженный `c:\` для системных корней

**Было:** `winSystemRoots = ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\programdata']`. На машинах, где Windows установлена на D:/E:, ни один путь не матчился — пользователь мог открыть `D:\Windows` как репо без предупреждения.

**Стало:** читаем `process.env.SystemRoot`, `process.env.ProgramFiles`, `process.env['ProgramFiles(x86)']`, `process.env.ProgramData`, нормализуем через `path.resolve` + `toLowerCase`. Fallback на старые `c:\` пути если env пуст (Windows Sandbox без env).

## 10. Статус задач по платформам

| Платформа | Описание | Где | Статус |
|---|---|---|---|
| macOS | `pathSecurity.ts` без case-insensitive ветки на darwin | `src/core/utils/pathSecurity.ts` | **закрыто (стрим 3)** |
| macOS | `repoPathGuard.ts` — `/Applications` отсутствует, нет CI-сравнения | `src/core/utils/repoPathGuard.ts` | **закрыто (стрим 4)** |
| macOS | Иконка `resources/icon.icns` отсутствует | `package.json/build.mac.icon` | **закрыто (стрим 4)** placeholder через `npm run build:icons` |
| macOS | Нет `hardenedRuntime` + entitlements | `package.json/build.mac` + `build/entitlements.mac.plist` | **закрыто (стрим 3)** |
| macOS | Нет `notarize` конфига | `package.json/build.mac.notarize` | `false` явно; реальная нотаризация требует Apple Developer ID, off-scope |
| macOS | Нет `mac.identity` — потенциальный hang в CI | `package.json/build.mac.identity` | **закрыто (стрим 4):** `null` явно (ad-hoc) |
| Linux | Иконка `resources/icon.png` отсутствует | `package.json/build.linux.icon` | **закрыто (стрим 4)** placeholder |
| Linux | Нет `--ozone-platform-hint=auto` для нативного Wayland | `src/main/main.ts` | **закрыто (стрим 3)** |
| Linux | `.deb` без maintainer/synopsis/desktop entry | `package.json/build.linux` | **закрыто (стрим 4)** |
| Linux | Не хватает Snap/Flatpak target'ов | `package.json/build.linux.target` | средний приоритет, не делаем |
| Linux | `safeStorage` без `secret-service` (KWallet/gnome-keyring) — fallback неясен | `src/main/main.ts` `aiStore` | проверено: `AiConfigStore.encode/decode` корректно fallback'ит на `plain:` префикс если `isEncryptionAvailable() === false`. Тесты в `tests/ai/AiConfigStore.test.ts` покрывают сценарий. |
| Win | Не предлагаем `git config core.longpaths true` при path-too-long | `src/core/safety/LongPathSuggester.ts` | закрыто ранее (стрим hardening 2026-05-09) |
| Win | LongPathSuggester только на русском | `src/core/safety/LongPathSuggester.locales.ts` | **закрыто (стрим 3)**: en/ru, выбор по `app.getLocale()` |
| Win | NSIS не предлагает включить Win10 Long-paths registry | `package.json/build.nsis` + `build/installer.nsh` | **закрыто (стрим 4)** |
| Cross | `showGitNotFoundMessage` — мёртвая кнопка «Указать путь», только ru, не quit'ит | `src/core/safety/RecoveryUI.ts` + `RecoveryUI.locales.ts` | **закрыто (стрим 4):** i18n en/ru, удалена мёртвая кнопка, ранний `app.quit()` при Quit, новый return type `{ shouldQuit: boolean }` |
| Cross | CI не валидирует electron-builder на mac/linux | `.github/workflows/release-pack.yml` | **закрыто (стрим 4):** matrix `[win/mac/ubuntu]`, `electron-builder --dir`, артефакты на 7 дней, триггер `workflow_dispatch` или PR-label `release-smoke` |
| Cross | Нет инструкций по сборке на разных платформах | `BUILD.md` + `docs/ru/BUILD.md` | **закрыто (стрим 4)** |

## 11. Иконки

**Стрим 4:** установлен placeholder-генератор `scripts/build-icons.mjs`
(зависимости: `png2icons`, `pngjs` — обе pure-JS, без бинарных
зависимостей, не требуют `iconutil`/`sharp`).

Запуск: `npm run build:icons` → создаёт три файла из единого 1024×1024
PNG-шаблона:
- `resources/icon.ico` (~430 КБ, multi-res Windows ICO).
- `resources/icon.icns` (~8 КБ, Apple iconset).
- `resources/icon.png` (~9 КБ, Linux AppImage/deb).

`resources/.gitignore` исключает эти файлы из репо — они генерируются
из шаблона при каждой сборке (locally + в CI release-pack workflow).

**Дизайн placeholder'а:** плоский синий фон + центральный блок
(геометрический). Это явное временное решение. Замена на реальный
дизайн-логотип не требует правок инфраструктуры — только замена
функции рисования в `scripts/build-icons.mjs` или подкладывание
готового master-PNG.

**Что не закрыто:**
- Реальный дизайн-логотип (нужен ассет от дизайнера, см.
  `docs/audit/cross-platform-2026-05-10.md` пункт «Что не делается»).
- Light/dark variant для macOS menu bar tray.
- Windows Tile icons (нужны только для Microsoft Store).

## Что проверить вручную (Mac/Linux runtime — следующий стрим)

1. Запуск `npm run build && npm start` на Ventura+ / Sonoma+.
2. Запуск на Ubuntu 22.04 / 24.04 (X11 и Wayland-сессии).
3. Запуск на Fedora (Wayland по умолчанию).
4. Открыть репо с non-ASCII путями (русские/японские).
5. Открыть репо с symlink'ами наружу — проверить `safePath` поведение.
6. Прогнать `electron-builder --mac --dir` после добавления icon.icns + entitlements.
7. Прогнать `electron-builder --linux --dir` после добавления icon.png.
8. Прогон fileWatcher на репо с >1000 файлов в верхнем уровне на macOS (FSEvents → fs.watch fallback).
