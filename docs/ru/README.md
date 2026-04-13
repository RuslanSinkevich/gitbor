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

---

## Стек

| Компонент | Технология |
|-----------|-----------|
| Desktop runtime | Electron 28 |
| UI | React 18, TypeScript, Vite 5 |
| Стили | CSS Modules, CSS-переменные `--sg-*` |
| Файловый наблюдатель | chokidar |
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
│   │       └── Logger.ts          # Файловое логирование
│   │
│   ├── main/                      # Точка входа Electron
│   │   ├── main.ts                # Создание окна, инициализация сервисов, autoHideMenuBar
│   │   ├── menu.ts                # Скрытое нативное меню (только клавиатурные ускорители)
│   │   └── i18n/                  # Локализация меню (ru, en)
│   │
│   ├── preload/
│   │   └── index.ts               # contextBridge.exposeInMainWorld('skyForkAPI')
│   │
│   └── renderer/                  # Фронтенд (React)
│       ├── src/
│       │   ├── App.tsx            # Корневой компонент (только композиция)
│       │   ├── api.ts             # Обёртка над skyForkAPI (invoke, onEvent)
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
│       │   │   └── settings/      # Настройки репозитория
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
├── docs/                          # Документация
│   ├── getting-started.md         # Установка и рабочий процесс
│   ├── architecture.md            # Обзор архитектуры
│   ├── features.md                # Список возможностей
│   ├── contributing.md            # Руководство по контрибьюции
│   ├── ru/                        # Русские переводы
│   └── internal/                  # Внутренняя документация модулей
│
├── dist/                          # Результат сборки
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
- **Интерактивный rebase** — pick/reword/edit/squash/fixup/drop
- **Вкладки репозиториев** — несколько репозиториев одновременно
- **Кастомное меню** — стабильное HTML/CSS меню (замена нативного Electron-меню)
- **Менеджер SSH-ключей** — генерация, просмотр, копирование, удаление
- **Настройки репозитория** — user.name/email, global/local
- **Уведомления (Toast)** — обратная связь для всех git-операций
- **Подтверждения** — опасные действия требуют подтверждения
- **Интеграция с системой** — открытие в проводнике/терминале, обновление (F5)
- **Защита от ошибок** — React ErrorBoundary предотвращает белый экран
- **i18n** — English и Russian
- **Темы** — тёмная и светлая

---

## Безопасность: 5 уровней защиты

1. **Git reflog** — встроенный, 90 дней
2. **Auto-stash** — автоматическое сохранение незакоммиченных изменений перед деструктивными операциями
3. **HEAD hash** — сохранение для rollback
4. **WAL-журнал** — `.git/SkyFork-journal.json`, begin/complete/fail
5. **RecoveryManager** — проверки при старте: lock-файлы, незавершённые операции, rebase, merge

---

## Документация

| Документ | Описание |
|----------|----------|
| [Начало работы](getting-started.md) | Установка, настройка, рабочий процесс, добавление фич |
| [Архитектура](architecture.md) | 4-слойный дизайн, поток данных, модули |
| [Возможности](features.md) | Что умеет SkyFork: граф, diff, merge, blame и др. |
| [Участие в разработке](contributing.md) | Стиль кода, конвенции, чеклист PR |

Внутренняя документация модулей: [`docs/internal/`](../internal/INDEX.md)

---

## Статус

Версия 0.1.0. Бэкенд и UI функционально готовы для MVP. Не протестирован в production.

## Лицензия

MIT
