# SkyFork

> English version: [README.md](../../README.md)

Бесплатный, open-source, кроссплатформенный десктопный Git-клиент на Electron. Альтернатива Fork/GitKraken/SourceTree.

Часть экосистемы Sky Platform.

---

## Быстрый старт

```bash
cd skyfork
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
| Desktop runtime | Electron 28 |
| UI | React 18, TypeScript, Vite 5 |
| Стили | CSS Modules, CSS-переменные `--sg-*` |
| Файловый наблюдатель | chokidar |
| Линтинг | ESLint (flat config) + Prettier |
| CI | GitHub Actions (lint, typecheck, test, build на 3 ОС) |
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
skyfork/
├── src/
│   ├── core/                      # Бэкенд (Main Process)
│   │   ├── bridge/                # IPC-мост (MessageBridge, messages)
│   │   ├── commands/              # Оркестратор команд (checkout, commit, merge, diff...)
│   │   │   ├── CommandHandler.ts  # Главный обработчик команд
│   │   │   ├── ConflictManager.ts # Merge-конфликты
│   │   │   ├── readCommands.ts    # Команды чтения (log, status, branches)
│   │   │   └── writeCommands.ts   # Команды записи (commit, push, merge)
│   │   ├── git/                   # Git-слой
│   │   │   ├── GitExecutor.ts     # Запуск git-процессов
│   │   │   ├── GitParser.ts       # Парсинг вывода git
│   │   │   ├── GitConfig.ts       # Чтение/запись git config (user.name, user.email)
│   │   │   ├── GraphLayout.ts     # Алгоритм раскладки графа коммитов
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
│   │   ├── ssh/                   # Управление SSH-ключами
│   │   │   └── SshKeyManager.ts   # Список, генерация, удаление SSH-ключей
│   │   ├── safety/                # 5 уровней защиты данных
│   │   │   ├── OperationQueue.ts  # Очередь: read параллельно, write последовательно
│   │   │   ├── OperationJournal.ts # WAL-журнал операций
│   │   │   ├── SafetyNet.ts       # Auto-stash + rollback
│   │   │   └── RecoveryManager.ts # Проверки при старте (lock, journal, rebase)
│   │   ├── state/
│   │   │   ├── StateManager.ts    # Единый источник состояния, мульти-репо
│   │   │   └── FileWatcher.ts     # Наблюдатель за файлами (chokidar, debounce 300ms)
│   │   └── utils/
│   │       ├── Logger.ts          # Асинхронное файловое логирование (WriteStream)
│   │       └── pathSecurity.ts    # Защита от path traversal + symlink + Windows case-insensitive
│   │
│   ├── main/                      # Точка входа Electron
│   │   └── main.ts                # Создание окна, инициализация сервисов, без нативного меню
│   │
│   ├── preload/
│   │   └── index.ts               # contextBridge.exposeInMainWorld('skyForkAPI')
│   │
│   └── renderer/                  # Фронтенд (React)
│       ├── src/
│       │   ├── App.tsx            # Корневой компонент (композиция)
│       │   ├── AppDialogs.tsx    # Все модальные диалоги (вынесены из App.tsx)
│       │   ├── api.ts             # Обёртка над skyForkAPI (invoke, onEvent, setIpcErrorHandler)
│       │   ├── features/          # Функциональные модули
│       │   │   ├── graph/         # Граф коммитов (виртуализированный)
│       │   │   ├── sidebar/       # Боковая панель (ветки, теги, stash, remotes)
│       │   │   ├── changes/       # Изменённые файлы (дерево), CommitBar (subject + desc)
│       │   │   ├── diff/          # Просмотр diff (inline + split, ignore whitespace)
│       │   │   ├── merge/         # Разрешение конфликтов (ConflictPanel, MergeEditor)
│       │   │   ├── toolbar/       # Панель инструментов
│       │   │   ├── blame/         # Git blame
│       │   │   ├── file-history/  # История файла
│       │   │   ├── rebase/        # Интерактивный rebase-редактор
│       │   │   ├── repo-manager/  # Управление репозиториями
│       │   │   ├── repo-tabs/     # Табы репозиториев
│       │   │   ├── titlebar/      # Кастомное меню (замена нативного меню Electron)
│       │   │   ├── layout/        # CommitsView, ChangesView, RightPanelContent
│       │   │   ├── ssh/           # Менеджер SSH-ключей
│       │   │   ├── settings/      # Настройки репозитория
│       │   │   ├── reflog/        # Git Reflog
│       │   │   ├── bisect/        # Git Bisect
│       │   │   ├── hooks/         # Git Hooks
│       │   │   ├── worktrees/     # Git Worktrees
│       │   │   ├── lfs/           # Git LFS
│       │   │   └── gitignore/     # Редактор .gitignore
│       │   ├── ui/                # UI-kit (SgButton, SgDialog, SgToast, MenuBar...)
│       │   ├── hooks/             # React-хуки (useAppState, useMenuActions, useOperationToasts...)
│       │   ├── i18n/              # Локализация UI (ru, en)
│       │   ├── styles/            # Глобальные стили, CSS-переменные, темы
│       │   ├── types/             # TypeScript-типы для renderer
│       │   └── pages/
│       │       └── showcase/      # UI Showcase (демо компонентов)
│       ├── package.json
│       └── vite.config.ts
│
├── tests/                         # Тесты (Vitest, 208 тестов)
│   ├── git/                       # Парсеры, менеджеры (GitExecutor, RebaseManager, ...)
│   ├── commands/                  # writeCommands, ConflictManager
│   ├── utils/                     # pathSecurity
│   ├── safety/                    # OperationQueue, AtomicWrite, Journal
│   ├── bridge/                    # IPC-контракты
│   └── i18n/                      # Полнота локализации, шаблоны
│
├── docs/                          # Документация
│   ├── getting-started.md         # Установка и рабочий процесс
│   ├── architecture.md            # Обзор архитектуры
│   ├── features.md                # Список возможностей
│   ├── contributing.md            # Руководство по контрибьюции
│   ├── testing.md                 # Тестирование (Vitest)
│   ├── ru/                        # Русские переводы
│   └── ru/                        # Русские переводы
│
├── dist/                          # Результат сборки
├── .github/workflows/ci.yml      # GitHub Actions CI
├── .gitattributes                 # Нормализация line endings
├── .editorconfig                  # Единый стиль отступов и EOL
├── .prettierrc                    # Конфигурация Prettier
├── eslint.config.mjs              # ESLint flat config
├── vitest.config.ts               # Конфигурация Vitest + coverage
├── package.json                   # Electron 28, TypeScript 5.3
└── tsconfig.json
```

---

## Ключевые возможности

- **Граф коммитов** — виртуализированная прокрутка, цвета веток, поиск
- **Боковая панель** — ветки, теги, stash, remotes; checkout, merge, rename, delete
- **Локальные изменения** — дерево файлов, stage/unstage/discard по файлу и по hunk
- **Просмотр diff** — inline + split, ignore whitespace, stage hunk
- **Разрешение merge-конфликтов** — двухколоночный редактор, авто-переход, предсказание
- **История файла и Git blame** — построчные аннотации, история по файлу
- **Интерактивный rebase** — pick/reword/edit/squash/fixup/drop, баннер прогресса
- **Вкладки репозиториев** — несколько репозиториев одновременно
- **Кастомное меню** — HTML/CSS меню с Edit-действиями, горячие клавиши (нативное меню удалено)
- **Менеджер SSH-ключей** — генерация, просмотр, копирование, удаление
- **Настройки репозитория** — user.name/email, global/local
- **Уведомления (Toast)** — обратная связь для всех git-операций
- **Подтверждения** — опасные действия требуют подтверждения
- **Интеграция с системой** — открытие в проводнике/терминале, обновление (F5)
- **Защита от ошибок** — React ErrorBoundary предотвращает белый экран
- **Reflog** — история HEAD с восстановлением
- **Git Bisect** — интерактивный поиск виновного коммита
- **Git Hooks** — просмотр и вкл/выкл хуков
- **Подписанные коммиты** — бейджи GPG/SSH в графе
- **Worktrees** — управление рабочими деревьями
- **Git LFS** — отслеживание больших файлов
- **Редактор .gitignore** — шаблоны Node, Python, Java, Rust, Go, IDE, OS
- **Сравнение двух коммитов** — diff между произвольными коммитами
- **Навигация стрелками** — ↑/↓ в графе коммитов
- **i18n** — English и Russian
- **Темы** — тёмная и светлая
- **Дистрибуция** — electron-builder для Win/Mac/Linux

---

## Безопасность данных

### 5 уровней защиты от потери данных

1. **Git reflog** — встроенный, 90 дней
2. **Auto-stash** — автоматическое сохранение незакоммиченных изменений перед деструктивными операциями
3. **HEAD hash** — сохранение для rollback
4. **WAL-журнал** — `.git/SkyFork-journal.json`, begin/complete/fail
5. **RecoveryManager** — проверки при старте: lock-файлы, незавершённые операции, rebase, merge

### Безопасность ввода

- **Path traversal protection** — `safePath()` валидирует пути через IPC: `realpathSync.native` для symlink, регистронезависимость на Windows
- **Filename validation** — `isSafeFilename()` проверяет имена SSH-ключей и git hooks на спецсимволы
- **IPC validation** — `handleCommand` валидирует `unknown` → проверка `type: string` перед dispatch
- **Shell injection protection** — `openInTerminal` использует `execFile`/`spawn` вместо `exec`
- **Log sanitization** — `sanitizeArgs` редактирует пароли и сообщения коммитов в логах
- **Safe clipboard** — `copyToClipboard()` обёртка с обработкой ошибок для всех операций буфера обмена
- **Electron sandbox** — `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- **Атомарная запись** — запись через tmp+rename с fsync, retry на Windows, защита от повреждения при крашe

### Кроссплатформенность

- `.gitattributes` для нормализации line endings (LF для исходников, CRLF для .bat/.cmd)
- Кроссплатформенные пути через `path.join()` / `path.resolve()` во всём проекте
- Терминал: fallback chain для Linux (gnome-terminal, konsole, xfce4-terminal, xterm)
- `NUL` / `/dev/null` автовыбор по платформе

---

## Документация

| Документ | Описание |
|----------|----------|
| [Начало работы](getting-started.md) | Установка, настройка, рабочий процесс, добавление фич |
| [Архитектура](architecture.md) | 4-слойный дизайн, поток данных, модули |
| [Возможности](features.md) | Что умеет SkyFork: граф, diff, merge, blame и др. |
| [Участие в разработке](contributing.md) | Стиль кода, конвенции, чеклист PR |
| [Тестирование](testing.md) | Vitest, структура тестов, ручное тестирование фич |

---

## Статус

Версия 0.1.0. Бэкенд и UI функционально готовы для MVP. **208** юнит-тестов (Vitest), ESLint + Prettier, CI через GitHub Actions. Не протестирован в production.

## Лицензия

MIT
