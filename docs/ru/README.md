# GitBor

> English version: [README.md](../../README.md)

Бесплатный кроссплатформенный десктопный Git-клиент на Electron. Альтернатива Fork/GitKraken/SourceTree. Исходники под лицензией MIT, но репозиторий закрыт — публично не хостится.

Часть экосистемы Sky Platform.

## Внешний вид

Скриншот интерфейса: граф коммитов, боковая панель (ветки), панель деталей коммита и просмотр diff (локализация на русском).

![GitBor — внешний вид](../images/gitbor-screenshot.png)

---

## Быстрый старт

```bash
cd gitbor
npm install
npm run dev
```

`npm run dev` запускает Vite (renderer на порту 5188) и Electron (main process) через `concurrently`.

### Сборка

```bash
npm run build        # Сборка renderer + main
npm start            # Запуск собранного приложения
```

### Тесты и линтинг

```bash
npm test             # Запуск всех тестов (Vitest)
npm run test:coverage # Тесты с покрытием
npx vitest           # Watch-режим
npm run lint         # ESLint проверка
npm run lint:fix     # ESLint с автофиксом
npm run format       # Prettier форматирование
```

### Дистрибуция

```bash
npm run dist:win     # Windows (NSIS + portable)
npm run dist:mac     # macOS (DMG)
npm run dist:linux   # Linux (AppImage + deb)
```

---

## Стек

| Компонент | Технология |
|-----------|-----------|
| Desktop runtime | Electron 40 |
| UI | React 18, TypeScript 5.9, Vite 6 |
| Стили | CSS Modules, CSS-переменные `--sg-*` |
| Файловый наблюдатель | chokidar 4 |
| Тесты | Vitest 4.1 (unit, <!-- TESTS_FILES -->58<!-- /TESTS_FILES --> файлов / <!-- TESTS_COUNT -->635<!-- /TESTS_COUNT --> тестов), Playwright 1.59 (E2E, Windows) |
| DX | husky 9 + lint-staged 17 (pre-commit) + `npm test` (pre-push), `npm run analyze` (rollup-plugin-visualizer) |
| Линтинг | ESLint 10 (flat config) + Prettier |
| CI | GitHub Actions: `ci.yml` (push, 3 ОС, Node 20) + `pr.yml` (PR, Windows, Node 22, +e2e) |
| Git | Встроенный git binary (`resources/git/{platform}/git`) |

---

## Архитектура

4 слоя, зависимости идут только вниз:

```
┌──────────────────────────────────────────────────────────┐
│  Renderer Process (React)                                │
│  UI: Меню, Sidebar, Graph, Changes, Diff, Merge, SSH    │
├──────────────────────────────────────────────────────────┤
│  Preload Script                                          │
│  contextBridge (безопасный мост IPC)                     │
├──────────────────────────────────────────────────────────┤
│  Main Process (Node.js)                                  │
│  Application + Safety + Git Layer + SSH Key Manager      │
├──────────────────────────────────────────────────────────┤
│  Bundled Git                                             │
│  resources/git/{platform}/git                            │
└──────────────────────────────────────────────────────────┘
```

### Поток данных

```
App.tsx → api.invoke() → preload (ipcRenderer) → MessageBridge (ipcMain)
  → CommandHandler → GitExecutor → git binary
```

---

## Структура проекта

```
gitbor/
├── src/
│   ├── core/                      # Бэкенд (Main Process)
│   │   ├── bridge/                # IPC-мост
│   │   │   ├── MessageBridge.ts   # Тонкий (~150 строк) роутер: cmd → handler из ipc/
│   │   │   ├── messages.ts        # Контракты RendererCommand / MainEvent
│   │   │   └── ipc/               # Подмодули хендлеров
│   │   │       ├── helpers.ts            # op / opWithPostMerge / runTracked / errOnFail
│   │   │       ├── handlersState.ts      # lifecycle, diff, blame, history
│   │   │       ├── handlersGitOps.ts     # push, pull, fetch, commit, stage, merge, rebase
│   │   │       ├── handlersRepoExtras.ts # LFS, worktrees, hooks, stats, bisect, settings, SSH
│   │   │       └── handlersAi.ts         # Конфиг AI-провайдера, generateCommitMessage
│   │   ├── commands/              # Оркестратор команд
│   │   │   ├── CommandHandler.ts  # Главный диспетчер (per-call lookup сервисов)
│   │   │   ├── ConflictManager.ts # Merge-конфликты
│   │   │   ├── readCommands.ts    # Команды чтения (log, status, branches)
│   │   │   └── writeCommands.ts   # Команды записи (commit, push, merge)
│   │   ├── git/                   # Git-слой
│   │   │   ├── GitExecutor.ts     # Запуск git-процессов (cwd фиксируется в конструкторе)
│   │   │   ├── GitParser.ts       # Парсинг вывода git (большие stdout — в WorkerPool)
│   │   │   ├── GitConfig.ts       # Чтение/запись git config (user.name, user.email)
│   │   │   ├── GraphLayout.ts     # Раскладка графа (worker thread при commits > 2000)
│   │   │   ├── DiffParser.ts      # Парсинг unified diff
│   │   │   ├── ConflictParser.ts  # Парсинг конфликт-маркеров
│   │   │   ├── BlameParser.ts     # Парсинг git blame
│   │   │   ├── FileHistoryParser.ts # История файла
│   │   │   ├── RebaseManager.ts   # Rebase-операции
│   │   │   ├── SubmoduleParser.ts # Парсинг submodules
│   │   │   ├── ReflogParser.ts    # Парсинг git reflog
│   │   │   ├── BisectManager.ts   # Git bisect: start/good/bad/skip/reset
│   │   │   ├── HooksManager.ts    # Git hooks: list, toggle
│   │   │   ├── WorktreeManager.ts # Git worktrees: list, add, remove
│   │   │   ├── LfsManager.ts      # Git LFS: status, track, untrack
│   │   │   └── types/             # Типы: Commit, Branch, Tag, GraphNode и др.
│   │   ├── ai/                    # AI-модуль (генерация commit message)
│   │   │   ├── AiService.ts       # Фасад: ensureProvider + generateCommitMessage
│   │   │   ├── AiHandlers.ts      # Per-requestId AbortController, маскирование секретов
│   │   │   ├── AiConfigStore.ts   # Хранилище в {userData}/ai-config.json (atomic write)
│   │   │   ├── prompts.ts         # buildCommitSystemPrompt (auto/en/ru), MAX_DIFF_CHARS
│   │   │   ├── qwenWebModels.ts   # Whitelist id моделей qwen3-*
│   │   │   ├── types.ts           # AiProviderConfig, AiCompletionResult, AiError
│   │   │   └── providers/
│   │   │       ├── base.ts                 # Интерфейс AiProvider
│   │   │       ├── OpenAiCompatibleProvider.ts # /v1/chat/completions + SSE
│   │   │       └── QwenWebProvider.ts          # chat.qwen.ai через сессионный токен
│   │   ├── ssh/                   # Управление SSH-ключами
│   │   │   └── SshKeyManager.ts   # Список, генерация, удаление SSH-ключей
│   │   ├── safety/                # Защита данных
│   │   │   ├── OperationQueue.ts  # Per-repo: read параллельно, write последовательно
│   │   │   ├── OperationJournal.ts # WAL-журнал операций
│   │   │   ├── SafetyNet.ts       # Auto-stash + rollback
│   │   │   ├── AtomicWrite.ts     # Атомарная запись (tmp+rename+fsync, retry на Windows через Atomics.wait)
│   │   │   └── RecoveryManager.ts # Проверки при старте (lock, journal, rebase)
│   │   ├── services/
│   │   │   └── RepoServicesRegistry.ts # Map<repoPath, {git, queue, safety}> + bootstrap
│   │   ├── state/
│   │   │   ├── StateManager.ts        # Фасад над тремя слоями ниже
│   │   │   ├── RepoSlicesStore.ts     # slicesByRepo Map + meta + mirror
│   │   │   ├── RepoStateRefresher.ts  # Все async refresh* + cold phase
│   │   │   ├── RepoEventBus.ts        # Каналы подписок: state / switch / close
│   │   │   ├── repoSlice.ts           # RepoSlice, GIT_*_FORMAT, hashGitStdout
│   │   │   ├── FileWatcher.ts         # Per-repo chokidar (debounce: .git 50мс, worktree 200мс)
│   │   │   ├── GraphCache.ts          # Кэш раскладки графа на репо
│   │   │   └── AuthorStatsCache.ts    # Кэш статистики кода по авторам
│   │   ├── workers/
│   │   │   ├── WorkerPool.ts      # 2 worker'а, round-robin, авто-respawn
│   │   │   └── parserWorker.ts    # parseStatus / parseCommits / computeGraphLayout
│   │   ├── activity/
│   │   │   ├── gitActivityStore.ts # Журнал git-операций (per-repo, кэп 100)
│   │   │   └── activityContext.ts  # AsyncLocalStorage для привязки exec → operation
│   │   └── utils/
│   │       ├── Logger.ts          # Singleton mainLogger (silent в prod, debug в dev)
│   │       ├── AppError.ts        # Структурированная ошибка: code + data для i18n в renderer
│   │       ├── pathSecurity.ts    # safePath (traversal + symlink), isSafeFilename
│   │       └── repoPathGuard.ts   # isDangerousRepoRoot (home, drive root, Windows...)
│   │
│   ├── main/                      # Точка входа Electron
│   │   └── main.ts                # Создание окна, инициализация сервисов, без нативного меню
│   │
│   ├── preload/
│   │   └── index.ts               # contextBridge.exposeInMainWorld('gitBorAPI')
│   │
│   └── renderer/                  # Фронтенд (React)
│       ├── src/
│       │   ├── App.tsx            # Корневой компонент (композиция)
│       │   ├── AppDialogs.tsx     # Все модальные диалоги в одном месте
│       │   ├── api.ts             # Обёртка над gitBorAPI (invoke, onEvent)
│       │   ├── features/          # Функциональные модули
│       │   │   ├── graph/         # Граф коммитов (виртуализированный)
│       │   │   ├── sidebar/       # Боковая панель (ветки, теги, stash, remotes)
│       │   │   ├── changes/       # Изменённые файлы (tree + fileTreeModel.ts), CommitBar
│       │   │   ├── diff/          # Просмотр diff (inline + split, ignore whitespace)
│       │   │   ├── merge/         # Разрешение конфликтов (ConflictPanel, MergeEditor)
│       │   │   ├── toolbar/       # Панель инструментов
│       │   │   ├── blame/         # Git blame
│       │   │   ├── file-history/  # История файла
│       │   │   ├── rebase/        # Интерактивный rebase-редактор
│       │   │   ├── repo-manager/  # Управление репозиториями
│       │   │   ├── repo-tabs/     # Табы репозиториев (вкладка «+» открывает RepoManager)
│       │   │   ├── titlebar/      # Кастомное меню (замена нативного меню Electron)
│       │   │   ├── layout/        # CommitsView, ChangesView, RightPanelContent
│       │   │   ├── ssh/           # Менеджер SSH-ключей
│       │   │   ├── settings/      # Настройки репозитория
│       │   │   ├── ai/            # AI: AiSettingsDialog, AiGenerateButton, presets, useAiConfig
│       │   │   ├── reflog/        # Git Reflog
│       │   │   ├── bisect/        # Git Bisect
│       │   │   ├── hooks/         # Git Hooks
│       │   │   ├── worktrees/     # Git Worktrees
│       │   │   ├── lfs/           # Git LFS
│       │   │   └── gitignore/     # Редактор .gitignore
│       │   ├── ui/                # UI-kit (SgButton, SgDialog, SgToast, SgPromptDialog, MenuBar...)
│       │   ├── hooks/             # React-хуки
│       │   │   ├── useAppState.ts          # Фасад над тремя хуками ниже
│       │   │   ├── useRepoSlices.ts        # slices Map + meta
│       │   │   ├── useRunningOps.ts        # Per-repo running ops + lastOpResult
│       │   │   ├── useStateSubscription.ts # Единый onMainEvent + dispatcher
│       │   │   ├── useMenuActions.ts       # Диспетчер действий меню/клавиатуры
│       │   │   ├── useKeyboardShortcuts.ts # Привязка шорткатов к меню-действиям
│       │   │   ├── useOperationToasts.ts   # Тост по результату операции
│       │   │   ├── useDiffState.ts         # Текущая цель diff
│       │   │   ├── useTheme.ts             # Тёмная/светлая + localStorage
│       │   │   ├── useToasts.ts            # Очередь тостов
│       │   │   ├── useContextMenu.ts       # Состояние контекстного меню
│       │   │   ├── useDialogs.ts           # Централизованная видимость диалогов
│       │   │   └── useAutoFetch.ts         # Фоновый fetch
│       │   ├── i18n/              # Локализация UI (ru, en)
│       │   ├── styles/            # Глобальные стили, CSS-переменные, темы
│       │   ├── types/             # TypeScript-типы для renderer
│       │   └── pages/
│       │       └── showcase/      # UI Showcase (демо компонентов)
│       ├── package.json
│       └── vite.config.ts
│
├── tests/                         # Юнит-тесты (Vitest, <!-- TESTS_COUNT -->635<!-- /TESTS_COUNT --> тестов в <!-- TESTS_FILES -->58<!-- /TESTS_FILES --> файлах)
│   ├── git/                       # Парсеры и менеджеры (GitExecutor, RebaseManager, ...)
│   ├── commands/                  # writeCommands (вкл. batch discardFiles), readCommands, ConflictManager
│   ├── state/                     # StateManager (мульти-репо), repoSlice
│   ├── services/                  # RepoServicesRegistry (lifecycle, изоляция)
│   ├── activity/                  # GitActivityStore
│   ├── safety/                    # OperationQueue, AtomicWrite, OperationJournal, RecoveryManager, LongPathSuggester
│   ├── bridge/                    # IPC-контракты, ipc/helpers, MessageBridge.handleCommand, handlersGitOps
│   ├── ai/                        # AiConfigStore, AiHandlers, AiService, providers (OpenAI/QwenWeb), prompts, presets
│   ├── changes/                   # fileTree (buildFileTree, collectFiles)
│   ├── repo-manager/              # recentRepos (фильтрация невалидных путей)
│   ├── main/                      # gracefulShutdown
│   ├── utils/                     # pathSecurity, repoPathGuard, AppError, Logger
│   └── i18n/                      # Полнота локализации, tpl
│
├── tests-e2e/                     # Playwright E2E (Windows-only, 3 спека)
│   ├── helpers.ts                 # launchApp(), makeFixtureRepo()
│   ├── app-launch.spec.ts         # Smoke: видимость titlebar
│   ├── open-repo.spec.ts          # autoOpenRepo через cwd=fixture
│   └── switch-tab.spec.ts         # Переключение между табами репозиториев
│
├── docs/                          # Документация
│   ├── images/                    # Скриншоты
│   └── ru/                        # Русские переводы
│
├── dist/                          # Результат сборки
├── .github/workflows/ci.yml       # CI на push (3 ОС, Node 20)
├── .github/workflows/pr.yml       # PR-гейт (Windows, Node 22, +e2e)
├── .husky/pre-commit              # husky 9 + lint-staged 17 + project-wide tsc
├── .husky/pre-push                # npm test (bypass через SKIP_TESTS=1)
├── .gitattributes                 # Нормализация line endings
├── .editorconfig                  # Единый стиль отступов и EOL
├── .prettierrc                    # Конфигурация Prettier
├── eslint.config.mjs              # ESLint flat config
├── vitest.config.ts               # Конфигурация Vitest + coverage
├── playwright.config.ts           # Playwright (Windows-only E2E)
├── package.json                   # Electron 40, TypeScript 5.9, Vite 6
└── tsconfig.json
```

---

## Ключевые возможности

- **Граф коммитов** — виртуализированная прокрутка, цвета веток, поиск
- **Боковая панель** — ветки, теги, stash, remotes; checkout, merge, rename, delete; current branch — зелёная точка; hover-действия per-branch (pin / solo / hide / note), Solo + Hide-фильтры графа и per-repo заметки по ветке
- **Локальные изменения** — дерево файлов, stage/unstage/discard по файлу и по hunk
- **Контекстное меню по папкам** — stage / unstage / discard / delete применяется ко всем файлам внутри (Staged/Unstaged)
- **Просмотр diff** — inline + split, ignore whitespace, hover-кнопки stage/discard/unstage поверх hunk-блока (как в Fork); без префиксов `+`/`−` в тексте строк (только цвет); ПКМ → «Копировать» (выделение или строка под курсором); кнопка «Просмотр Markdown» в тулбаре для `.md`-файлов; legacy-кодировки (CP1251/CP866) декодируются эвристикой, кириллица в старых `.sql`-файлах читается нормально
- **Разрешение merge-конфликтов** — двухколоночный редактор, авто-переход, предсказание
- **История файла и Git blame** — построчные аннотации, история по файлу
- **Интерактивный rebase** — pick/reword/edit/squash/fixup/drop, баннер прогресса
- **Вкладки репозиториев** — независимые per-repo движки, вкладка «+» открывает RepoManager; список открытых вкладок и активная вкладка восстанавливаются при следующем запуске
- **Менеджер репозиториев** — недавние / открыть / clone / init; доступ через вкладку «+» или повторный клик по активной вкладке
- **AI-сообщения коммитов** — генерация одной кнопкой из staged diff; OpenAI-compatible (OpenAI/Ollama/LM Studio/DeepSeek/Groq) и Qwen Web (сессионный токен chat.qwen.ai); язык commit message `auto`/`en`/`ru`
- **Кастомное меню** — HTML/CSS меню с Edit-действиями, горячие клавиши (нативное меню удалено)
- **Менеджер SSH-ключей** — генерация, просмотр, копирование, удаление
- **Настройки репозитория** — user.name/email, global/local
- **Stash-диалог** — поле имени с allowEmpty (пусто = `git stash` без `-m`)
- **Уведомления (Toast)** — обратная связь для всех git-операций
- **Подтверждения** — опасные действия требуют подтверждения
- **Интеграция с системой** — открытие в проводнике/терминале, обновление (F5)
- **Защита от ошибок** — React ErrorBoundary предотвращает белый экран
- **Журнал git-активности** — per-repo лог git-вызовов (start/append/finish, кэп 100, обрезка stdout/stderr до 16 KiB)
- **Статистика репозитория** — контрибьюторы, статистика кода с кэшем по авторам
- **Reflog** — история HEAD с восстановлением
- **Git Bisect** — интерактивный поиск виновного коммита
- **Git Hooks** — просмотр и вкл/выкл хуков
- **Подписанные коммиты** — бейджи GPG/SSH в графе
- **Worktrees** — управление рабочими деревьями
- **Git LFS** — отслеживание больших файлов
- **Редактор .gitignore** — шаблоны Node, Python, Java, Rust, Go, IDE, OS
- **Сравнение двух коммитов** — diff между произвольными коммитами
- **Навигация стрелками** — ↑/↓ в графе коммитов
- **i18n** — English и Russian (полнота ключей покрыта `i18n.test.ts`)
- **Темы** — тёмная и светлая
- **Дистрибуция** — electron-builder для Win/Mac/Linux

---

## Multi-Repo движок

Каждое открытое репо — независимый набор сервисов: длинный `git pull` на репо A не блокирует операции на репо B.

- **`RepoServicesRegistry`** — `Map<repoPath, { git, queue, safety }>`. `acquire(repoPath)` лениво создаёт сервисы с `cwd`, фиксированным в конструкторе; `release(repoPath)` шлёт SIGTERM только своим inflight процессам.
- **`StateManager`** = фасад над тремя слоями:
  - `RepoSlicesStore` — `slicesByRepo: Map<repoPath, RepoSlice>` + общий `meta` (`openRepos`, `activeRepoIndex`).
  - `RepoStateRefresher` — все async `refresh*` методы, с гардом `isRepoTracked(repoPath)` — фоновый refresh не «оживит» только что закрытое репо.
  - `RepoEventBus` — три канала подписок (state / switch / close).
- **WorkerPool** — 2 `worker_threads`, round-robin, авто-respawn. `parseStatus`/`parseCommits`/`computeGraphLayout` уходят в worker по порогам размера (status > 256 KB, log > 512 KB, layout > 2000 коммитов).
- **Зеркало в renderer** — `useAppState` — фасад над `useRepoSlices` / `useRunningOps` / `useStateSubscription`. `state.isOperationRunning` и `state.currentOperation` берутся ТОЛЬКО из активной вкладки — fetch на A не отключит кнопки на B.
- **Дедуп `graphData`** — `MessageBridge.sentGraphByRepo` пропускает идентичные payload'ы, повторное A→B→A не гонит мегабайты JSON через IPC.

## AI-модуль

- **Провайдеры**:
  - `OpenAiCompatibleProvider` — `/v1/chat/completions` с SSE-стримом; OpenAI, Ollama, LM Studio, DeepSeek, Groq.
  - `QwenWebProvider` — неофициальный мост к `chat.qwen.ai` через сессионный токен из `localStorage` (без официального API-ключа DashScope).
- **`AiConfigStore`** — `{userData}/ai-config.json`, atomic write, API-ключ / Qwen-токен шифруются Electron `safeStorage` (DPAPI / Keychain / libsecret); fallback на префикс `plain:`, если key store недоступен.
- **`AiHandlers`** — per-`requestId` `AbortController`, `cancelAll()` при выключении, маскирование секретов (`••••••••`) в `getConfig` для UI.
- **Промпты** — system + user с языком commit message `auto`/`en`/`ru`; diff обрезается до `MAX_DIFF_CHARS = 6000` (head 70% + tail 20%).
- **UI** — `AiSettingsDialog` (нативный `select` пресетов с optgroup Cloud/Local/Web + Custom), `AiGenerateButton` в commit bar, hot path через `useAiConfig`.

## Безопасность данных

### 5 уровней защиты от потери данных

1. **Git reflog** — встроенный, 90 дней
2. **Auto-stash** — автоматическое сохранение незакоммиченных изменений перед деструктивными операциями
3. **HEAD hash** — сохранение для rollback
4. **WAL-журнал** — `.git/GitBor-journal.json`, begin/complete/fail
5. **RecoveryManager** — проверки при старте: lock-файлы (stale `.git/index.lock` игнорируется при запуске), незавершённые операции, rebase, merge

### Безопасность ввода

- **Path traversal protection** — `safePath()` валидирует пути через IPC: `realpathSync.native` для symlink, регистронезависимость на Windows
- **Гард опасных корней** — `isDangerousRepoRoot()` отключает worktree-watcher для home / drive root / `C:\Windows` / `Program Files` / `node_modules` (открыть такие папки разрешено; гасится только watcher, чтобы не словить EPERM-каскад)
- **Filename validation** — `isSafeFilename()` проверяет имена SSH-ключей и git hooks на спецсимволы
- **`AppError`** — структурированная ошибка с `code` + `data`; `MessageBridge` шлёт `error`-event с кодом, renderer переводит через `locale.repoErrors[code]`
- **Log sanitization** — `sanitizeArgs` редактирует commit-сообщения и passphrases после `-m` / `-C` / `-N` / `--message`
- **Shell injection protection** — `openInTerminal` использует `execFile`/`spawn`, никогда `exec`
- **Safe clipboard** — `copyToClipboard()` обёртка с обработкой ошибок
- **Electron sandbox** — `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- **Атомарная запись** — tmp+rename с fsync, retry на Windows через `Atomics.wait` (без busy-spin)

### Кроссплатформенность

- `.gitattributes` для нормализации line endings (LF для исходников, CRLF для .bat/.cmd)
- Кроссплатформенные пути через `path.join()` / `path.resolve()` во всём проекте
- Терминал: fallback chain для Linux (gnome-terminal, konsole, xfce4-terminal, xterm)
- `NUL` / `/dev/null` автовыбор по платформе

## Логирование

Двухсторонняя система: main и renderer пишут логи только в dev-режиме; в production console молчит.

- **Main** — singleton `mainLogger` с уровнями `silent`/`error`/`warn`/`info`/`debug`. `configureMainLogger({ isProduction })` в `main.ts` ставит дефолт по `app.isPackaged`. ENV `GITBOR_LOG_LEVEL=debug` перебивает без пересборки.
- **Renderer** — префикс `[GitBor]`; методы — no-op в production-сборке Vite (`import.meta.env.DEV === false`).
- **`perf.ts`** — отдельный диагностический инструмент со своим opt-in (`GITBOR_PERF=1` / `window.__GITBOR_PERF__ = true`).

---

## Статус

Версия 0.1.0. Бэкенд и UI функционально готовы для MVP. **<!-- TESTS_COUNT -->635<!-- /TESTS_COUNT -->** юнит-тестов в <!-- TESTS_FILES -->58<!-- /TESTS_FILES --> файлах (Vitest 4.1) плюс 3 Playwright E2E-спека (Windows). ESLint + Prettier настроены; husky 9 + lint-staged 17 на pre-commit гонят `eslint --fix` и project-wide `tsc --noEmit`; `npm test` запускается в `.husky/pre-push` (bypass через `SKIP_TESTS=1`). CI: `ci.yml` (push, lint/typecheck/test/build на Ubuntu / Windows / macOS, Node 20) + `pr.yml` (PR, всё то же плюс E2E на Windows, Node 22). 0 уязвимостей в `npm audit` (root + renderer). Не протестирован в production.

## Лицензия

MIT
