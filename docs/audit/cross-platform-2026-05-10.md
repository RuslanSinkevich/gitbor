# GitBor — Cross-platform readiness (2026-05-10, стрим 4 — параллельный)

> **Status: DONE.** Четыре независимых блока (A, B, C, D) выполнены параллельно
> в отдельных табах Cursor. Все verify-метрики не ухудшились, добавлено 10
> новых тестов и 1 новый test-файл.
>
> Продолжение `cross-platform-2026-05-09-3.md`. Цель — закрыть всё, что реально
> сделать на Windows-машине без Apple Developer ID и без mac/linux runners.

---

## Цель стрима

Из stream-3 остались блокеры, технически решаемые на Windows, но не вошедшие
в тот стрим из-за объёма и зависимости от внешних факторов. В этом стриме
закрыли:

1. Path-safety на macOS (`/Applications`, case-insensitive POSIX).
2. Реальные иконки вместо default Electron icon.
3. Linux .deb metadata (maintainer/desktop entry).
4. NSIS LongPathsEnabled на установке.
5. macOS `identity: null` явно (защита от CI hang).
6. CI workflow для electron-builder на 3 платформах.
7. Onboarding UX: GitNotFound диалог i18n + ранний quit.
8. BUILD.md инструкции по сборке.

## Хард-запреты (соблюдены)

- `src/renderer/src/App.tsx` строки 342–360 — не трогали.
- `src/core/ai/providers/*` — не трогали.
- `src/core/bridge/messages.ts` — не трогали.
- `src/core/bridge/ipc/handlersShell.ts` — не трогали.

## Бейзлайн → Факт

| Метрика | Стрим 3 | Стрим 4 |
|---|---|---|
| `npm test` | 473 / 46 | **483 / 47** (+10 / +1) |
| `tsc --noEmit` (main + renderer) | 0 errors | **0 errors** |
| `npm run lint` | 0 errors / 152 warnings | **0 / 152** |
| `npm run build` | OK | **OK** |
| `npm run e2e` | 3 / 3 | **3 / 3** |
| `electron-builder --dir --win` | OK (default-icon warning) | **OK без warning'а** |
| Electron | 40.9.3 | 40.9.3 |

---

## Метод стрима — параллельный запуск

В отличие от линейных стримов 1-3, этот стрим был выполнен в **четырёх
параллельных табах Cursor**, каждый с независимым LLM-агентом и явным scope'ом
файлов без пересечений. Координация — через ТЗ-промт от parent-агента,
финальный verify + мерж — обратно у parent-агента.

### Разбиение по зонам ответственности

| Стрим | Эксклюзивные файлы | Цель |
|---|---|---|
| **A — Path safety polish** | `src/core/utils/repoPathGuard.ts` + `tests/utils/repoPathGuard.test.ts` | `/Applications` в prohibited, darwin case-insensitive |
| **B — Packaging & icons** | `package.json`, `package-lock.json`, `scripts/build-icons.mjs`, `resources/.gitignore`, `build/installer.nsh`, генерируемые `resources/icon.{ico,icns,png}` | Иконки, NSIS LongPaths, Linux .deb metadata, mac.identity, dev-deps |
| **C — Onboarding UX** | `src/core/safety/RecoveryUI.ts`, `src/core/safety/RecoveryUI.locales.ts`, `src/main/main.ts`, `tests/safety/RecoveryUI.test.ts` | i18n GitNotFound, quit handler, удаление мёртвой кнопки |
| **D — CI & Docs** | `.github/workflows/release-pack.yml`, `BUILD.md`, `docs/ru/BUILD.md` | Matrix electron-builder smoke + сборочные инструкции |

Пересечений по файлам нет. Единственный ложный конфликт: stream B зафиксировал
`npm run build` падение на TS ошибке в `main.ts:186` как pre-existing — на
самом деле это race condition с stream C (он менял сигнатуру `initServices`
в этом же районе). На момент финального verify обе правки смержены, ошибки нет.

---

## Что сделано (по блокам)

### Блок A — Path safety polish

**Цель:** закрыть macOS-специфичные дыры в `repoPathGuard`.

**Сделано в `src/core/utils/repoPathGuard.ts`:**
- Добавлен helper `isCaseInsensitiveFs()` (читает `process.platform` при
  каждом вызове, мокается через `Object.defineProperty`).
- `/Applications` добавлен в `posixSystemRoots` и `prohibited`.
- POSIX-ветка использует case-insensitive сравнение через локальный helper
  `matches(r)` когда `isCaseInsensitiveFs() === true`.
- `path.resolve()` заменён на `path.win32.resolve()` / `path.posix.resolve()`
  с разветвлением по `isWin`. **Причина:** тесты запускаются на Windows-runtime
  с моком `process.platform = 'darwin'`. С обычным `path.resolve` POSIX-ветка
  получала бы `'C:\\Applications'` вместо `'/Applications'` и сравнения
  ломались. На реальных Linux/macOS поведение идентично прежнему
  (`path === path.posix` на этих платформах).

**Тесты в `tests/utils/repoPathGuard.test.ts`:**
- Добавлены хелперы `setPlatform` / `restorePlatform` (паттерн из
  `LongPathSuggester.test.ts`).
- Новый describe-блок с 5 тестами:
  - `darwin: блокирует /Applications точно`
  - `darwin: блокирует /Applications/GitBor.app/Contents`
  - `darwin: блокирует /applications/foo` (lowercase)
  - `darwin: блокирует /LIBRARY/Preferences` (uppercase)
  - `linux: НЕ блокирует /applications/foo` (case-sensitive)

**Результат:** 13 / 0 (8 старых + 5 новых).

### Блок B — Packaging & icons

**Цель:** вернуть real-icons, добавить metadata для Linux .deb, NSIS LongPaths,
mac.identity для CI.

**dev-deps:**
- `png2icons@2.0.1` — генератор ICO/ICNS из PNG, pure JS, без `iconutil`/`sharp`.
- `pngjs@7.0.0` — PNG writer, pure JS.

**`scripts/build-icons.mjs` (новый):**
- Рисует 1024×1024 PNG (фон `#1E40AF`, центральный блок `#F8FAFC`,
  плейсхолдер-геометрия).
- Через `pngjs.PNG` генерит буфер.
- Через `png2icons.createICO/createICNS` → ICO + ICNS.
- Сохраняет в `resources/icon.{ico,icns,png}`.
- Идемпотентный.

**`resources/.gitignore` (новый):** `icon.ico`, `icon.icns`, `icon.png` — не
коммитятся, генерятся из шаблона.

**`package.json`:**
- `scripts.build:icons` → `node scripts/build-icons.mjs`.
- `build.win.icon` = `resources/icon.ico`.
- `build.mac.icon` = `resources/icon.icns`.
- `build.mac.identity` = `null` (явно ad-hoc; защита от hang в CI без
  `CSC_LINK`).
- `build.linux.icon` = `resources/icon.png`.
- `build.linux.maintainer` = `Skycode <noreply@skycode.local>`.
- `build.linux.synopsis` = `Cross-platform desktop Git client`.
- `build.linux.description` = подробное описание.
- `build.linux.desktop.entry`:
  - `Name = GitBor`
  - `Categories = Development;RevisionControl;`
  - `StartupWMClass = GitBor`
  - `MimeType = inode/directory;`
- `build.nsis.include` = `build/installer.nsh`.

**`build/installer.nsh` (новый):**
```nsh
!macro customInstall
  ${IfNot} ${AtMostWin8.1}
    SetRegView 64
    WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1
    SetRegView lastused
  ${EndIf}
!macroend
```

**Сгенерированные иконки (размеры):**
- `resources/icon.png` — 8832 байт.
- `resources/icon.ico` — 432 254 байт.
- `resources/icon.icns` — 8422 байт.

**Smoke verify:** `npx electron-builder --dir --win` — без warning
`default Electron icon is used`.

### Блок C — Onboarding UX (GitNotFound)

**Цель:** закрыть четыре дефекта в `showGitNotFoundMessage`: мёртвая кнопка,
ru-only, нет ранней терминации, нет re-check.

**Сделано в `src/core/safety/RecoveryUI.locales.ts` (новый):**
- Структура `GitNotFoundLocale` с `title` / `message` / `buttons` / `downloadUrl`.
- `en` и `ru` локали с двумя кнопками `[Download Git, Quit]`. Мёртвая
  «Указать путь к Git» удалена — без обработчика она вводила в заблуждение.
- `pickGitNotFoundLocale(localeTag)` — выбор по BCP-47 префиксу.

**Сделано в `src/core/safety/RecoveryUI.ts`:**
- Импорт `app` из `electron`.
- `currentGitNotFoundLocale()` — читает `app.getLocale()` с try/catch
  (для совместимости с unit-тестами с пустым моком).
- `showGitNotFoundMessage` теперь возвращает `Promise<{ shouldQuit: boolean }>`:
  - Click `Download Git` → `void shell.openExternal(downloadUrl)` → `shouldQuit: false` (UI остаётся).
  - Click `Quit` или `cancelId: 1` (ESC/крестик) → `shouldQuit: true`.

**Сделано в `src/main/main.ts`:**
- Сигнатура `initServices` изменена с `Promise<void>` на `Promise<{ aborted: boolean }>`.
- При `shouldQuit: true` от диалога — `app.quit()` + `return { aborted: true }` сразу,
  до создания `repoRegistry` / `MessageBridge` / `FileWatcher`.
- В `app.whenReady().then(...)`: `if (aborted) return;` ДО `Menu.setApplicationMenu`,
  `createWindow`, `loadWindow`, `autoOpenRepo`. Существующие `window-all-closed`
  / `before-quit` хэндлеры дочистят процесс — `repoRegistry?.disposeAll()` no-op.

**Тесты в `tests/safety/RecoveryUI.test.ts` (новый):**
- 5 тестов: Quit, Download, EN locale, RU locale, cancelId.
- Per-test переключение локали через `vi.hoisted` + `mockReturnValue` без
  `vi.resetModules()` (модуль не кэширует локаль — читает из `app.getLocale()`
  при каждом вызове).

**Результат:** 5 / 0. Совместный прогон с `LongPathSuggester.test.ts` —
12 / 0 (per-file scope `vi.mock` не пересекается).

### Блок D — CI & Docs

**Сделано в `.github/workflows/release-pack.yml` (новый):**
- Матрица `[windows-latest, macos-latest, ubuntu-latest]`, `fail-fast: false`.
- Триггеры: `workflow_dispatch` (ручной) + PR с label `release-smoke`.
- Шаги: checkout → Node 22 + кэш npm для двух package-lock'ов → install →
  Linux apt-deps (`libgbm1`, `libgtk-3-0`, `libnss3`, `libxss1`,
  `libasound2t64`, `fakeroot`, `dpkg`) → `npm run build` →
  `npm run build:icons` → `npx electron-builder --dir` с
  `CSC_IDENTITY_AUTO_DISCOVERY: false` → upload artifact (release/win-unpacked,
  release/mac, release/linux-unpacked) на 7 дней.
- НЕ подписывает, НЕ нотарит. Только smoke-валидация что
  `electron-builder` не валит сборку на mac/linux.

**Сделано в `BUILD.md` (корень, 120 строк):**
- Prerequisites (Node 22, npm 10, Git, platform-specific notes).
- Build (стандартный без packaging).
- Packaging (build:icons → dist:win/mac/linux).
- Подсекции по платформам: подпись, нотарь, env-переменные.
- CI: краткое описание трёх workflow.
- Known limitations.
- Troubleshooting.

**Сделано в `docs/ru/BUILD.md` (124 строки):**
- Дословный перевод BUILD.md. Команды/env/пути на английском.

---

## Финальная верификация

```powershell
npm run lint                                                   # 0 errors / 152 warnings
npx tsc -p tsconfig.main.json --noEmit                         # OK
npx tsc -p src/renderer/tsconfig.json --noEmit                 # OK
npm test                                                       # 483 / 47 passed
npm run build                                                  # OK
npm run e2e                                                    # 3 / 3 passed
npx electron-builder --dir --win                               # OK без icon-warning
```

Все acceptance-критерии выполнены.

---

## Изменённые/созданные файлы

| Файл | Тип | Стрим |
|---|---|---|
| `src/core/utils/repoPathGuard.ts` | M | A |
| `tests/utils/repoPathGuard.test.ts` | M | A |
| `package.json` | M | B |
| `package-lock.json` | M | B |
| `scripts/build-icons.mjs` | + | B |
| `resources/.gitignore` | + | B |
| `build/installer.nsh` | + | B |
| `src/core/safety/RecoveryUI.ts` | M | C |
| `src/core/safety/RecoveryUI.locales.ts` | + | C |
| `src/main/main.ts` | M | C |
| `tests/safety/RecoveryUI.test.ts` | + | C |
| `.github/workflows/release-pack.yml` | + | D |
| `BUILD.md` | + | D |
| `docs/ru/BUILD.md` | + | D |
| `docs/cross-platform-checklist.md` | M | parent |
| `docs/audit/cross-platform-2026-05-10.md` | + | parent |

Всего: 8 новых, 8 изменённых. Сгенерированные иконки (`resources/icon.{ico,icns,png}`)
не в git — gitignored.

---

## Что остаётся вне scope (явно)

- **Bundled git for Windows** — отдельный продуктовый стрим. Рассмотрен путь Fork:
  bundle MinGit + Settings UI + GPL-2 attribution в About-диалоге. Технически готова
  треть инфраструктуры (`GitExecutor` параметризуется путём, `RecoveryUI` маршрутизирует
  error path, добавлен `mac.identity: null` под CI). Решение «делать или нет»
  продуктовое — нет данных «у X% пользователей нет git». См. предыдущие сессии аудита.
- **Apple Developer ID + реальная нотаризация** — вне scope, нужен Apple ID.
- **Реальный дизайн-логотип** — placeholder функционально достаточен для
  smoke-сборок и таскбара. Замена не требует правок инфраструктуры.
- **Cross-platform Playwright E2E** — нужны mac/linux runners + xvfb для headless
  Linux. CI minutes + 1-2 недели flake-debugging. Отдельный стрим.
- **Snap/Flatpak target'ы** — требуют snapcraft / flatpak-builder в CI. Низкий приоритет.

---

## Контрольные точки для следующей сессии

1. **Прочитать этот файл целиком** — самодостаточен.
2. **Проверить что `release-pack.yml` отрабатывает** на mac/linux — запустить через
   `gh workflow run "Release Pack Smoke"` или поставить label `release-smoke` на PR.
   Если падает на mac/linux — там и есть следующий блок работ.
3. **Если есть продуктовое решение про bundled git** — отдельный стрим со
   своим audit doc.
4. **Если появился реальный дизайн-логотип** — заменить функцию рисования в
   `scripts/build-icons.mjs` либо положить master 1024×1024 PNG и переписать
   скрипт на чтение этого PNG вместо генерации.
5. Workspace rule: ответы начинаются с `🐰 — [model]`, на русском, без лести,
   без god-файлов.
