> English version: [docs/en/BUILD.md](en/BUILD.md)

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
- **Linux**: `fakeroot` и `dpkg` для `.deb`; `rpmbuild` для `.rpm`;
  AppImage собирается без дополнительных системных пакетов на Ubuntu 22.04+.

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

Вывод: `release/GitBor-X.Y.Z.dmg` (архитектура машины сборки). В CI собираются
оба варианта — `GitBor-X.Y.Z-x64.dmg` (Intel) и `GitBor-X.Y.Z-arm64.dmg`
(Apple Silicon). Локально обе архитектуры: `npx electron-builder --mac --x64 --arm64`
(имя задаётся так же, как в `release.yml`, через `--config.dmg.artifactName`).

Подпись кода: ad-hoc (`mac.identity: "-"`). Для подписи Developer ID
сними `CSC_IDENTITY_AUTO_DISCOVERY: false` в CI и предоставь:

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (нотаризация)
- Или `CSC_LINK` + `CSC_KEY_PASSWORD` для явного сертификата.

`mac.notarize: false` — значение по умолчанию; переключи на `true` и
добавь env Apple ID, чтобы включить нотаризацию.

Hardened runtime включён. Entitlements в `build/entitlements.mac.plist`.

### Linux (AppImage + .deb + .rpm)

```bash
npm run dist:linux
```

Вывод: `release/GitBor-X.Y.Z.AppImage`, `release/gitbor_X.Y.Z_amd64.deb`,
`release/gitbor-X.Y.Z.x86_64.rpm`.

`.deb` / `.rpm` включают maintainer/synopsis/desktop entry. AppImage
запускается на большинстве glibc-based дистрибутивов (Ubuntu 22.04+,
Fedora 38+, Debian 12+).

### Варианты сборки без AI

Для сред, где AI-функции нужно вырезать, скрипты `dist:*:no-ai` собирают
с `GITBOR_AI=0` и отдельными appId/productName/publish URL:

```bash
npm run dist:win:no-ai
npm run dist:mac:no-ai
npm run dist:linux:no-ai
npm run dist:win:all      # обычный и no-ai варианты для Windows
```

## CI

- `.github/workflows/ci.yml` — lint + tsc + test + build на
  Windows/macOS/Ubuntu (matrix). Без пакетинга.
- `.github/workflows/pr.yml` — Windows e2e через Playwright.
- `.github/workflows/release.yml` — сборка установщиков всех платформ и
  вариантов; по тегу `vX.Y.Z` публикует их в GitHub Release (см. «Релизы и
  автообновление» ниже).
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
- `sg-layout:*` — размеры панелей (`sidebar-width`, `changes-file-list-width:<repo>`,
  `changes-staged-height:<repo>`, `commits-graph-height:<repo>`, `commits-detail-width:<repo>`).
- `sg-sidebar-sections`, `sg-branch-folders:<repo>[:<remote>]` —
  состояние раскрытия секций сайдбара и дерева веток.
- `sg-branch-pinned`, `sg-branch-hidden`, `sg-graph-solo`, `sg-branch-notes`
  (с суффиксом `:<repo>`) — закреплённые / скрытые ветки, фильтр графа по
  ветке, заметки по веткам.
- `sg-recent-repos`, `sg-open-repos`, `sg-last-active-repo` — списки
  недавних / открытых / активного репо (восстанавливаются при следующем
  запуске).
- `sg-clone-base-dir`, `sg-init-base-dir` — последние папки для clone / init.
- `sg-gitignore-banner-dismissed:<repo>` — скрытая подсказка про `.gitignore`.
- `gitbor.commitDraft:<repo>` — несохранённый черновик сообщения коммита
  (черновики со старым ключом `skycode.commitDraft` переносятся автоматически).
- `gitbor.stash.includeUntracked` — последний выбор «Включить новые файлы» в окне «Отложить».
- `gitbor.graph.soloMode` — режим фильтра по ветке: «Только свои» / «Вся история».
- `gitbor.log` — opt-in флаг debug-логов в renderer.

**Чистое удаление** (NSIS-uninstaller это НЕ чистит): удалить папку
`GitBor` по пути выше. На Windows — также `HKCU\Software\GitBor`,
если что-то писалось туда через NSIS-скрипты (сейчас не используется).

## Релизы и автообновление

### Как выпустить версию

Релизы собирает GitHub Actions (`.github/workflows/release.yml`) — для публичного репозитория бесплатно.

1. Поднять `version` в `package.json` **и** `src/renderer/package.json` (должны совпадать).
2. Написать список изменений в `build/release-notes.md` — блоки `<!-- ru -->` и `<!-- en -->`, по одной короткой строке на пункт. Из этого файла берутся и текст GitHub Release, и список «что нового» в окне обновления.
3. Закоммитить, поставить тег `vX.Y.Z` и запушить его (`git tag v0.1.23 && git push origin v0.1.23`).
4. Workflow собирает 6 вариантов (Windows / Linux / macOS × обычный / No AI; macOS — для Intel и Apple Silicon) и прикладывает к GitHub Release:
   - установщики (`*.exe`, `*.dmg`, `*.AppImage`, `*.deb`, `*.rpm`) и `*.blockmap` для дифф-обновлений;
   - файлы каналов обновления: `latest.yml` / `latest-mac.yml` / `latest-linux.yml` для обычной сборки и `noai.yml` / `noai-mac.yml` / `noai-linux.yml` для No AI.

Ручной запуск workflow (Actions → Release → Run workflow) только собирает артефакты без публикации — удобно проверить, что всё собирается.

Сборки не подписаны: Windows показывает SmartScreen, macOS — предупреждение Gatekeeper.

### Как работает автообновление

`electron-updater` в `src/main/AppUpdater.ts`, источник и политика — в `src/main/updateFlavor.ts`:

- **Откуда:** GitHub Releases репозитория `RuslanSinkevich/gitbor`. Обычная сборка читает канал `latest*.yml`, No AI — `noai*.yml`; установщик чужого варианта не принимается.
- **Когда:** через ~8 с после старта установленной версии, загрузка в фоне, затем окно «Перезапустить и установить» со списком изменений.
- **Список «что нового»:** поле `releaseNotes` в yml, которое electron-builder заполняет из `build/release-notes.md` (`src/main/releaseNotes.ts`). Если поля нет, используется запасной запрос к сайту.
- **Не работает:** в dev (`npm run dev`), в портативной версии, при `GITBOR_SKIP_UPDATE_CHECK=1`.
- **Ручная проверка:** «О программе» → «Проверить обновления».
- **Запасной источник:** `GITBOR_UPDATE_BASE_URL=<url>` переключает на generic-источник (например, бакет) с раскладкой `<url>/win/`, `<url>/win/no_ai/`, `<url>/mac/`, `<url>/linux/` и т. д.

**Проверка после релиза:** запустить предыдущую установленную версию — через ~8 с в логе (`<userData>/logs/YYYY-MM-DD.log` при `GITBOR_LOG_LEVEL=debug`) появится `appUpdater: … available X.Y.Z`, затем окно перезапуска.

**Деградация:** нет сети, релиз без нужного yml или ошибка GitHub — приложение работает дальше, в логе `appUpdater: … check failed`, ручная проверка показывает «Не удалось проверить обновления».

**Переход со старых версий:** версии до перехода на GitHub Releases проверяют только старый источник — их нужно один раз обновить установщиком вручную.

### Ограничения по платформам

- **Windows:** автообновление — только у NSIS-установщика; портативная версия не обновляется.
- **macOS:** без подписи Developer ID и нотаризации автообновление ненадёжно (`mac.identity: "-"`, `mac.notarize: false`).
- **Linux:** обновляется AppImage; `.deb` / `.rpm` — нет (только через свой apt / yum-репозиторий).

## Известные ограничения

- Нотаризация macOS требует Apple Developer ID — не настроена.
- Автообновление: GitHub Releases (см. «Релизы и автообновление» выше); macOS без подписи — автообновление не для prod.
- Реальные продуктовые иконки ещё не нарисованы; placeholder-иконки
  геометрические/авто-сгенерированные. См. `scripts/build-icons.mjs`.
- Bundled Git для Windows: не включён; пользователям нужно установить
  Git отдельно.
- Snap/Flatpak Linux targets: не настроены.

## Диагностика проблем

**`electron-builder` падает с "Cannot find module 'png2icons'"** —
сначала запусти `npm install`; `png2icons` и `pngjs` — это dev-deps,
используемые `build:icons`.

**macOS: «Приложение повреждено»** — так выглядит сборка совсем без подписи
(`mac.identity: null`, было до 0.1.23 включительно): electron-builder правит
бандл, исходная ad-hoc подпись Electron ломается, и Gatekeeper на Apple Silicon
считает приложение повреждённым. «Правый клик → Открыть» тут не помогает,
только снятие карантина: `xattr -cr /Applications/GitBor.app`.
С `mac.identity: "-"` сборка подписана ad-hoc, и macOS вместо этого пишет
«не удалось проверить разработчика»: Системные настройки → Конфиденциальность
и безопасность → «Всё равно открыть».

**Linux AppImage не запускается** — убедись, что у файла AppImage есть
`chmod +x`. На Ubuntu 24.04+ AppImage требует `libfuse2`:
`sudo apt install libfuse2`.

**Windows installer падает на длинных путях** — инсталлятор пытается
выставить реестровый ключ `LongPathsEnabled`; если он не применился,
запусти от имени администратора или вручную установи
`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`.
