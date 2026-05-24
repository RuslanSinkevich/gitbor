# Сборка GitBor

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

Вывод: `release/GitBor-Setup-X.Y.Z.exe`, `release/GitBor-Portable-X.Y.Z.exe`
(имена без пробелов — совпадают с `latest.yml` для auto-update).
(portable). NSIS-инсталлятор опционально включает реестровый ключ
Win10 LongPathsEnabled (требует прав администратора во время установки)
— см. `build/installer.nsh`.

Подпись кода: не настроена. Добавь `CSC_LINK` (путь к .pfx) и
`CSC_KEY_PASSWORD` в env, чтобы включить.

### macOS (.dmg)

```bash
npm run dist:mac
```

Вывод: `release/GitBor-X.Y.Z.dmg`.

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

Вывод: `release/GitBor-X.Y.Z.AppImage`, `release/gitbor_X.Y.Z_amd64.deb`.

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

### Локальный запуск release-pack smoke

Workflow `release-pack.yml` запускается только вручную — расписания нет.
Два способа запустить:

**Через GitHub CLI (любая ветка):**

```bash
gh workflow run "Release Pack Smoke" --ref main
```

Замени `main` на нужную ветку. Workflow крутит Windows / macOS / Ubuntu
параллельно.

**Через PR-label:** добавь метку `release-smoke` к открытому pull
request — workflow сам подхватит её и запакует с HEAD'а PR.

**Где смотреть артефакты:** GitHub Actions → страница run'а → раздел
**Artifacts**. Retention — 7 дней. Имена:

- `gitbor-Windows-unpacked` — `win-unpacked/` от `electron-builder --win --dir`.
- `gitbor-macOS-unpacked` — `mac-arm64/GitBor.app` (или `mac/` на x64).
- `gitbor-Linux-unpacked` — `linux-unpacked/`.

**Что проверять после скачивания:** каждый архив распаковывается без
ошибок и содержит бинарь GitBor (`gitbor.exe` /
`GitBor.app/Contents/MacOS/GitBor` / `gitbor`). Запуск UI в smoke не
входит (в CI-runner'ах нет дисплея) — валидируется только pipeline
пакетинга.

## Где хранятся данные пользователя

Где установленное приложение читает/пишет данные на машине юзера —
пригодится для саппорта, бэкапов и чистого удаления.

`<userData>` (Electron `app.getPath('userData')`) разворачивается в:

- **Windows**: `%APPDATA%\GitBor\` (напр. `C:\Users\<имя>\AppData\Roaming\GitBor\`)
- **macOS**: `~/Library/Application Support/GitBor/`
- **Linux**: `~/.config/GitBor/`

Файлы, которые пишет main-процесс:

| Путь | Кто пишет | Что внутри |
|------|-----------|------------|
| `<userData>/ai-config.json` | `AiConfigStore` | Конфиг AI-провайдеров; API-ключи / Qwen-токен шифруются через Electron `safeStorage` (префикс `enc:`), fallback `plain:` если key store недоступен. |
| `<userData>/logs/YYYY-MM-DD.log` | `Logger` | Файловый лог — открывается только при не-`silent` уровне. В собранной версии по умолчанию `silent` (файл не пишется), включается через `GITBOR_LOG_LEVEL=info|debug|...`. |
| `<userData>/graphCache/` | `GraphCache` | Кэш layout'ов графа коммитов по репо. |
| `<userData>/stats-cache/` | `AuthorStatsCache` | Кэш статистики по авторам. |

Состояние внутри репозитория:

| Путь | Кто пишет | Что внутри |
|------|-----------|------------|
| `<repo>/.git/GitBor-journal.json` | `OperationJournal` | WAL-журнал текущих деструктивных операций (begin/complete/fail). |

Состояние renderer'а лежит в Chromium `localStorage` (per Electron
session, физически в `<userData>/Local Storage/`). Префиксы ключей:

- `sg-theme`, `sg-lang` — текущая тема / язык UI.
- `sg-layout:*` — размеры split-pane'ов (напр. `sg-layout:changes-file-list-width:<repo>`,
  `sg-layout:commits-graph-height:<repo>`, `sg-layout:commits-detail-width:<repo>`).
- `sg-sidebar-sections`, `sg-branch-folders:<repo>[:<remote>]` —
  состояние раскрытия секций сайдбара и дерева веток.
- `sg-recent-repos`, `sg-open-repos`, `sg-last-active-repo` — списки
  недавних / открытых / активного репо (восстанавливаются при следующем
  запуске).
- `gitbor.log` — opt-in флаг debug-логов в renderer.

**Чистое удаление** (NSIS-uninstaller это НЕ чистит): удалить папку
`GitBor` по пути выше. На Windows — также `HKCU\Software\GitBor`,
если что-то писалось туда через NSIS-скрипты (сейчас не используется).

## Дистрибуция и авто-обновления

### Куда выкладывать релизы

`electron-builder` создаёт `release/` с инсталляторами, блокмапами и
`latest.yml` / `latest-mac.yml` / `latest-linux.yml`. Эти metadata-файлы
читает авто-апдейтер.

Рекомендованные таргеты:

- **GitHub Releases** — самый простой. Прописать `build.publish` в
  `package.json`: `{"provider": "github", "owner": "...", "repo":
  "..."}` и запустить `electron-builder --publish always` (нужен
  `GH_TOKEN` в env). `latest.yml` загрузится автоматически вместе с
  бинарями.
- **Generic HTTP / S3 / CDN** — `{"provider": "generic", "url":
  "https://your-cdn/gitbor/"}`. Содержимое `release/` (инсталляторы +
  `latest*.yml` + `*.blockmap`) залить по этому префиксу вручную или
  через CI.

Пока `build.publish` не настроен, файлы `latest.yml` в `release/` ни на
что не влияют — они становятся осмысленными только когда тот же URL
доступен из работающего приложения с авто-апдейтером.

### Авто-обновления

Подключены через `electron-updater` (`src/main/AppUpdater.ts`):

- **URL:** `build.publish` → `https://storage.yandexcloud.net/gitbor/`
- **Когда:** ~8 с после старта (packaged NSIS), фоновая загрузка
- **Не работает:** dev (`npm run dev`), portable `.exe`, `GITBOR_SKIP_UPDATE_CHECK=1`
- **Ручная проверка:** About → «Проверить обновления»

После `npm run dist:win` залить в бакет `latest.yml`, NSIS `.exe` и `.blockmap`.
Версия в `package.json` должна расти на каждый релиз.

- **Windows**: NSIS-таргет поддерживает авто-апдейты (delta-обновления
  через `.blockmap`); portable — НЕ поддерживает.
- **macOS**: требует подпись Developer ID И нотаризацию — оба сейчас
  отключены (`mac.identity: null`, `mac.notarize: false`).
- **Linux**: AppImage поддерживает обновления; `.deb` — нет (раздавать
  через свой apt-репозиторий).

## Известные ограничения

- Нотаризация macOS требует Apple Developer ID — не настроена.
- Авто-обновления: NSIS + Yandex bucket (см. «Авто-обновления» выше). macOS без подписи — авто-update не для prod.
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
Правый клик → Open или `xattr -d com.apple.quarantine GitBor.app`,
чтобы обойти Gatekeeper для разработки.

**Linux AppImage не запускается** — убедись, что у файла AppImage есть
`chmod +x`. На Ubuntu 24.04+ AppImage требует `libfuse2`:
`sudo apt install libfuse2`.

**Windows installer падает на длинных путях** — инсталлятор пытается
выставить реестровый ключ `LongPathsEnabled`; если он не применился,
запусти от имени администратора или вручную установи
`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`.
