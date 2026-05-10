# SkyFork — Cross-platform readiness (2026-05-09, стрим 3)

> **Status: DONE.** Все блоки A–F закрыты, метрики не ухудшились,
> новые тесты добавлены. Документация обновлена.
>
> Продолжение `upgrade-2026-05-09.md` и `hardening-2026-05-09-2.md`. Цель —
> закрыть статически решаемые блокеры дистрибуции и сделать код кросс-платформенным
> там, где это возможно без mac/linux машины.

---

## Цель стрима

Привести проект к состоянию «дистрибуция собирается на всех трёх платформах,
runtime-поведение корректное на всех трёх», в пределах того, что можно сделать
на Windows-машине без Apple Developer ID и без Linux-runner'ов.

## Хард-запреты (соблюдены)

- `src/renderer/src/App.tsx` строки 342–360 — не трогали.
- `src/core/ai/providers/*` — не трогали.
- `src/core/bridge/messages.ts` — не трогали.
- `src/core/bridge/ipc/handlersShell.ts` — не трогали.
- Бренд: «SkyFork» — не путали со «Skycode».

## Бейзлайн → Факт

| Метрика | Бейзлайн | После стрима |
|---|---|---|
| `npm test` | 470 / 46 | **473 / 46** (+3 darwin/linux case-insensitive) |
| `tsc --noEmit` (main + renderer) | 0 errors | **0 errors** |
| `npm run lint` | 0 errors / 152 warnings | **0 / 152** |
| `npm run build` | OK | **OK** |
| `npm run e2e` | 3 / 3 | **3 / 3** |
| `electron-builder --dir --win` | (не проверялось) | **OK** (default icon warning) |
| Electron | 40.9.3 | 40.9.3 |

---

## Что сделано (по блокам)

### Блок A — Smoke distribution build (DONE)

`npx electron-builder --dir --win` прошёл с warning'ом:
`default Electron icon is used  reason=application icon is not set`.
Сборка не падает — electron-builder сам fallback'ит на встроенный логотип
при отсутствии `resources/icon.ico`. Дополнительная правка не понадобилась
для блока A; блок F всё равно отрабатывался ради чистоты конфига.

### Блок B — macOS distribution config (DONE)

**Создан** `build/entitlements.mac.plist` со стандартным набором для Electron:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
	<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
	<true/>
	<key>com.apple.security.cs.disable-library-validation</key>
	<true/>
	<key>com.apple.security.inherit</key>
	<true/>
</dict>
</plist>
```

В `package.json/build.mac` добавлено:

```json
"hardenedRuntime": true,
"gatekeeperAssess": false,
"entitlements": "build/entitlements.mac.plist",
"entitlementsInherit": "build/entitlements.mac.plist",
"notarize": false
```

Реальная нотаризация (Apple Developer ID) — вне scope.

### Блок C — Linux Wayland support (DONE)

В `src/main/main.ts` сразу после `process.on('uncaughtException')`:

```ts
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}
```

`auto`, а не `wayland`, чтобы Electron мог откатиться к X11 если Wayland
недоступен. Guard по `process.platform === 'linux'` исключает влияние
на Win/macOS.

### Блок D — i18n LongPathSuggester (DONE)

**Создан** `src/core/safety/LongPathSuggester.locales.ts` с двумя локалями
(`en`/`ru`) и функцией `pickLongPathLocale(localeTag)`, выбирающей по
префиксу `ru` → `ru`, иначе `en`.

В `LongPathSuggester.ts`:
- Импорт `app` из `electron` + `pickLongPathLocale`.
- `currentLocale()` оборачивает `app.getLocale()` в try/catch с fallback
  на `en` (нужно для unit-тестов с пустым моком electron, где `getLocale`
  не определён).
- `showSuggestDialog` принимает `LongPathLocale`, рендерит из неё
  `title`/`message`/`detail`/`buttons`.
- Сообщения успеха/ошибки берутся из `locale.successMessage` /
  `locale.errorMessage(reason)`.
- URL «Подробнее» — `locale.learnMoreUrl` (для русской локали используется
  локализованное MS-зеркало `learn.microsoft.com/ru-ru/...`).

Существующие тесты `tests/safety/LongPathSuggester.test.ts` НЕ проверяли
буквальные строки (только response codes и факт вызова диалога) — поэтому
правок в тестах не потребовалось, все 7 кейсов прошли без изменений.

### Блок E — pathSecurity macOS case-insensitive (DONE)

В `src/core/utils/pathSecurity.ts`:

- Удалена module-level константа `isWin = process.platform === 'win32'`
  (она зафиксировалась бы на момент import и сделала `Object.defineProperty`
  в тестах бесполезным).
- Добавлена функция `isCaseInsensitiveFs()` которая читает `process.platform`
  при каждом вызове и возвращает `true` для `win32 || darwin`.
- Обе ветки case-folding'а в `safePath` (pre-symlink и post-realpath) теперь
  используют `isCaseInsensitiveFs()`.

В `tests/utils/pathSecurity.test.ts`:

- Добавлены хелперы `setPlatform` / `restorePlatform` через
  `Object.defineProperty(process, 'platform', ...)` (паттерн из
  `LongPathSuggester.test.ts`).
- Новый describe-блок `safePath case-insensitive FS (darwin/win32)`:
  - `darwin: rejects ../ traversal even with case mismatch` — `../etc/passwd`
    отбивается даже с case-insensitive семантикой.
  - `darwin: rejects traversal that walks out via case-mismatched parent` —
    `../OtherRepo/secret` отбивается.
  - `linux: case-sensitive — путь с другим регистром базы воспринимается
    как traversal` — на linux `../test-repo` ≠ `Test-Repo`, отбивается.

Linux (ext4) НЕ затронут — он остался case-sensitive.

### Блок F — Иконки (DONE, best-effort)

Из `package.json/build` удалены три строки:
- `"icon": "resources/icon.ico"` (win)
- `"icon": "resources/icon.icns"` (mac)
- `"icon": "resources/icon.png"` (linux)

Electron-builder использует встроенную default-иконку. Это временное решение,
зафиксированное в `docs/cross-platform-checklist.md` §11.

**Альтернативы (не выбраны):**
- Генерация placeholder'ов через `sharp` — добавляет dev-dep + бинарную
  зависимость.
- Ручное построение ICO/ICNS — ICNS требует macOS-only `iconutil`.

При появлении дизайн-ассета достаточно положить файлы в `resources/` и
вернуть `"icon"` строки в `package.json`.

---

## Финальная верификация

```powershell
npm run lint                                                   # 0 errors / 152 warnings
npx tsc -p tsconfig.main.json --noEmit                         # OK
npx tsc -p src/renderer/tsconfig.json --noEmit                 # OK
npm test                                                       # 473 / 46 passed
npm run build                                                  # OK
npm run e2e                                                    # 3 / 3 passed
npx electron-builder --dir --win                               # OK (default icon warning)
```

Все acceptance-критерии выполнены или превышены.

---

## Что остаётся вне scope (явно)

- Bundled git для Windows (~50 МБ, GPL-2 review).
- Cross-platform Playwright E2E (нужны mac/linux runners в CI).
- Apple Developer ID / реальная нотаризация (`mac.notarize` остался `false`,
  `mac.identity` не задан).
- Создание реальных иконок (нужен дизайн-ассет, см. checklist §11).
- Типизация 152 lint warnings (≈2 часа, не блокер).
- `safeStorage` fallback для Linux без secret service (отдельная задача).
- Snap/Flatpak target'ы (средний приоритет, см. checklist).

---

## Diff'ы по файлам

| Файл | Изменение |
|---|---|
| `package.json` | удалены три `"icon": ...`, добавлены `hardenedRuntime`/`entitlements`/`notarize` в `mac` |
| `build/entitlements.mac.plist` | **новый**, 4 entitlement'а |
| `src/main/main.ts` | +6 строк: Wayland switch с linux-guard'ом |
| `src/core/utils/pathSecurity.ts` | `isWin` константа → `isCaseInsensitiveFs()` функция (win32 \|\| darwin) |
| `tests/utils/pathSecurity.test.ts` | +3 теста, +хелперы setPlatform/restorePlatform |
| `src/core/safety/LongPathSuggester.locales.ts` | **новый**, en/ru локали |
| `src/core/safety/LongPathSuggester.ts` | импорт локалей, `currentLocale()`, диалоги читают строки из локали |
| `docs/cross-platform-checklist.md` | секции 1, 4, 6, 10 обновлены, §11 (иконки TODO) добавлена |

Всего: 2 новых файла (`entitlements.mac.plist`, `LongPathSuggester.locales.ts`),
6 изменённых, 0 удалённых.
