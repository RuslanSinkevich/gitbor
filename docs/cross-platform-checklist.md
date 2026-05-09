# Cross-platform чек-лист (Skyfork)

> Дата: 2026-05-09. Стрим аудита для определения «что ломается, если завтра запустить на Mac/Linux».
> Runtime-валидация на Mac/Linux вне скоупа этого стрима — здесь только статический аудит.

## 1. Ветви по `process.platform`

| Файл | Ветви | Полная тройка? | Заметки |
|---|---|---|---|
| `src/main/main.ts:279` | `!== 'darwin'` | da (стандарт macOS quit-on-window-close) | OK |
| `src/core/utils/repoPathGuard.ts:28` | win32 / else (POSIX) | macOS попадает в POSIX-ветку, у неё в `posixSystemRoots` есть `/Library`, `/System`, `/Applications` нет (см. 8) | macOS частично |
| `src/core/utils/repoPathGuard.ts:50` | win32 / else | то же | macOS частично |
| `src/core/utils/pathSecurity.ts:4` | `isWin = win32` | else = case-sensitive POSIX | macOS HFS+/APFS обычно case-insensitive по умолчанию (как Win), но не всегда. Сравнение через `toLowerCase()` отключено для не-Win — на macOS с case-insensitive FS path-traversal через регистр имени теоретически проходит. **Низкий риск, в чек-лист.** |
| `src/core/bridge/ipc/handlersRepoExtras.ts:205,212` | win32 / darwin / else | OK, явная тройка | OK |
| `src/core/commands/readCommands.ts:86` | `nullDev = NUL : /dev/null` | Linux/macOS общий `/dev/null`, OK | OK |
| `src/preload/index.ts:30` | `process.platform` экспортируется в renderer | renderer использует для ветки UI (если есть) | OK |

**Вывод:** грубых дыр в платформенных ветвях нет. macOS-specific секция в `repoPathGuard.ts` не выделена (она получает POSIX-ветку), но `posixSystemRoots` уже содержит `/Library`, `/System`, что покрывает большинство кейсов. `/Applications` не отбит — пользователь может случайно `git init` в `/Applications/SkyFork.app/...`. Маловероятно.

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
| `mac.icon` | `resources/icon.icns` — **файла нет** (только `.gitkeep` в `resources/`). При первой mac-сборке `electron-builder` упадёт «icon not found». |
| `mac.category` | `public.app-category.developer-tools` — OK |
| `mac.hardenedRuntime` | **не выставлено** → не пройдёт notarization (Apple требует с 2019). |
| `mac.entitlements` / `mac.entitlementsInherit` | **не выставлены** → даже с hardenedRuntime не запустится Electron из-за allow-jit и allow-unsigned-executable-memory. |
| `mac.notarize` | **не настроено** (нужен Apple ID + app-specific password или API key). |
| Подпись (`mac.identity`) | **не указана** — будет ad-hoc. Для распространения нужен Developer ID. |

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
| NSIS installer + LongPathsEnabled | NSIS не устанавливает Win10 Long-paths registry (это ручной reg-tweak пользователя). Добавлять — опциональный custom NSIS-step. |
| Antivirus задержка fs-операций | Не контролируется приложением; chokidar уже использует `awaitWriteFinish` для git-папки. |
| `windowsHide: true` в spawn'ах git | Уже стоит во всех вызовах `GitExecutor`. Терминал-окна git не мелькают. **OK.** |
| `core.quotePath=false` | Уже передаётся как `git -c core.quotePath=false ...` в каждом вызове — non-ASCII пути не выводятся в `\nnn`-эскейпах. **OK.** |

**Кандидат на следующий стрим:** автоматически предлагать `git config --global core.longpaths true` если SkyFork обнаружил репо с длинным путём и git упал.

## 6. Linux: Wayland vs X11, inotify limits, AppImage vs deb vs flatpak

| Аспект | Состояние |
|---|---|
| Wayland | Electron 32+ работает в Wayland через `--ozone-platform-hint=auto`, но по умолчанию ставится X11 в XWayland. Для нативного Wayland нужно добавить аргумент в `app.commandLine.appendSwitch('ozone-platform-hint', 'auto')` либо документировать как ручной флаг. **Не сделано.** |
| `inotify` watch limits | chokidar 4 на Linux использует `fs.watch` (рекурсивный с Node 20+). На больших worktree упирается в `fs.inotify.max_user_watches` (default 8192–65536). Уже есть hard-stop по `WORKTREE_TOPLEVEL_LIMIT=1000` в `FileWatcher.ts` — рандомные большие репо не валятся. **OK.** |
| `linux.target` | `[AppImage, deb]` — OK для Ubuntu/Debian + universal AppImage. Snap/flatpak не сделано. |
| `linux.icon` | `resources/icon.png` — **файла нет**, нужен 512×512. |
| Rendering glitches на Wayland (transparent BG) | Возможны, но конкретные баги без runtime неизвестны. |

## 7. Bundled git (`resources/git/{platform}/git`)

| Платформа | Содержимое | Размер |
|---|---|---|
| `resources/` | только `.gitkeep` | 0 B |

**Вывод:** git **не бандлится**. Используется системный (`PATH`-lookup в `GitExecutor`). На Windows — пользователь должен иметь Git for Windows; на macOS — Xcode CLT или brew git; на Linux — пакет менеджера.

`src/core/safety/RecoveryUI.ts:checkGitAvailable` обнаруживает отсутствие git и показывает диалог со ссылкой на git-scm.com.

**Кандидат на следующий стрим (опционально):** бандлить portable git для Windows (~50 MB) → нулевая зависимость от системного git. На mac/Linux — не нужно (git везде есть из коробки или через bundled CLT).

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

## 10. Mac/Linux баги — В ЧЕК-ЛИСТ (не фиксим в этом стриме)

| Платформа | Описание | Где | Приоритет |
|---|---|---|---|
| macOS/Linux | `pathSecurity.ts` не делает case-insensitive сравнение в POSIX-ветке. На case-insensitive APFS path-traversal через `Foo/../foo` теоретически проходит | `src/core/utils/pathSecurity.ts:4-23` | низкий — в renderer паттернах нет userland-источников path |
| macOS | Иконка `resources/icon.icns` отсутствует — `electron-builder --mac` упадёт | `package.json/build.mac.icon` | блокер для DMG |
| macOS | Нет `hardenedRuntime` + entitlements — DMG не запустится после notarize | `package.json/build.mac` | блокер для распространения |
| macOS | Нет `notarize` конфига — Apple Gatekeeper отклонит | `package.json/build.mac` | блокер |
| Linux | Иконка `resources/icon.png` отсутствует | `package.json/build.linux.icon` | блокер для AppImage |
| Linux | Нет `--ozone-platform-hint=auto` для нативного Wayland — крутится через XWayland | `src/main/main.ts` `app.commandLine.appendSwitch` | улучшение UX |
| Linux | Не хватает Snap/Flatpak target'ов — мейнстрим-дистрибуции через snap/flathub | `package.json/build.linux.target` | средний |
| Win | Не предлагаем `git config core.longpaths true` при ENOENT/path-too-long | `src/core/git/GitExecutor.ts` обработка ошибок | средний |
| Win | NSIS не предлагает включить Win10 Long-paths registry | `package.json/build.nsis` | низкий |

## Что проверить вручную (Mac/Linux runtime — следующий стрим)

1. Запуск `npm run build && npm start` на Ventura+ / Sonoma+.
2. Запуск на Ubuntu 22.04 / 24.04 (X11 и Wayland-сессии).
3. Запуск на Fedora (Wayland по умолчанию).
4. Открыть репо с non-ASCII путями (русские/японские).
5. Открыть репо с symlink'ами наружу — проверить `safePath` поведение.
6. Прогнать `electron-builder --mac --dir` после добавления icon.icns + entitlements.
7. Прогнать `electron-builder --linux --dir` после добавления icon.png.
8. Прогон fileWatcher на репо с >1000 файлов в верхнем уровне на macOS (FSEvents → fs.watch fallback).
