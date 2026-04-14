# SkyFork — Документация

## Обзор

SkyFork — standalone десктопный Git-клиент на Electron. Часть экосистемы Sky.
Бэкенд переиспользуется из SkyFork (VS Code extension) с адаптацией под Electron.

## Архитектура: 4 слоя

```
Renderer Process (React)  → UI: Sidebar, Graph, Changes, Detail, Merge, SSH, Settings
Preload Script            → contextBridge (безопасный мост)
Main Process (Node.js)    → Application + Safety + Git Layer
Bundled Git               → resources/git/{platform}/git
```

Зависимости идут только вниз. Каждый слой знает только о нижнем.

## Документы

| # | Файл | Модуль | Слой | Из SkyFork |
|---|------|--------|------|------------|
| 00 | [00-OVERVIEW.md](00-OVERVIEW.md) | Обзор проекта | — | Новый |
| 01 | [01-ARCHITECTURE.md](01-ARCHITECTURE.md) | Архитектура Electron | — | Новый |
| 02 | [02-TYPES.md](02-TYPES.md) | types.ts | Git Layer | Адаптирован (убран readonly) |
| 03 | [03-GIT-EXECUTOR.md](03-GIT-EXECUTOR.md) | GitExecutor | Git Layer | Адаптирован (bundled git, логирование, env) |
| 04 | [04-GIT-PARSER.md](04-GIT-PARSER.md) | GitParser | Git Layer | Без изменений |
| 05 | [05-GRAPH-LAYOUT.md](05-GRAPH-LAYOUT.md) | GraphLayout | Git Layer | Без изменений |
| 06 | [06-ATOMIC-WRITE.md](06-ATOMIC-WRITE.md) | AtomicWrite | Safety Layer | Адаптирован (cleanup .tmp, retry) |
| 07 | [07-OPERATION-JOURNAL.md](07-OPERATION-JOURNAL.md) | OperationJournal (WAL) | Safety Layer | Переименование (SkyFork-journal) |
| 08 | [08-SAFETY-NET.md](08-SAFETY-NET.md) | SafetyNet | Safety Layer | Переименование (SkyFork auto-stash) |
| 09 | [09-OPERATION-QUEUE.md](09-OPERATION-QUEUE.md) | OperationQueue | Safety Layer | Без изменений |
| 10 | [10-RECOVERY-MANAGER.md](10-RECOVERY-MANAGER.md) | RecoveryManager | Safety Layer | Адаптирован (Electron dialog) |
| 11 | [11-STATE-MANAGER.md](11-STATE-MANAGER.md) | StateManager | Application Layer | Без изменений |
| 12 | [12-FILE-WATCHER.md](12-FILE-WATCHER.md) | FileWatcher | Application Layer | Адаптирован (chokidar вместо vscode.workspace) |
| 13 | [13-COMMAND-HANDLER.md](13-COMMAND-HANDLER.md) | CommandHandler | Application Layer | Адаптирован (собственный diff/merge) |
| 14 | [14-MESSAGES.md](14-MESSAGES.md) | messages.ts (IPC протокол) | Bridge Layer | Расширен (45+ команд, 30+ событий) |
| 15 | [15-IPC-BRIDGE.md](15-IPC-BRIDGE.md) | IPC Bridge | Bridge Layer | Новый (mapped types, строгая типизация) |
| 16 | [16-MAIN-PROCESS.md](16-MAIN-PROCESS.md) | main.ts (Electron) | Integration | Новый (нативное меню удалено) |
| 17 | [17-CONFLICT-MANAGER.md](17-CONFLICT-MANAGER.md) | ConflictManager | Application + UI | Адаптирован (ConflictPanel + MergeEditor) |
| 18 | [18-CONTEXT-MENUS.md](18-CONTEXT-MENUS.md) | Контекстные меню | UI | Адаптирован (подтверждения для опасных действий) |

## Новые модули (не описаны в отдельных документах)

| Модуль | Слой | Описание |
|--------|------|----------|
| **GitConfig** | Git Layer | Чтение/запись git config (user.name, user.email, local/global) |
| **SshKeyManager** | Core | Управление SSH-ключами (~/.ssh/): list, generate, delete, read public |
| **MenuBar** | UI | Кастомное HTML/CSS меню (нативное меню полностью удалено) |
| **TitleBar** | UI | Заголовок окна с меню (File, Edit, View, Repository, Branch, Help), тема, язык |
| **AboutDialog** | UI | Диалог "О программе" |
| **SshKeysDialog** | UI | Менеджер SSH-ключей: просмотр, генерация, копирование, удаление |
| **RepoSettingsDialog** | UI | Настройки репозитория: user.name/email, global/local |
| **ErrorBoundary** | UI | React error boundary — защита от белого экрана |
| **CommitsView** | Layout | Вид коммитов: граф + детали + diff |
| **ChangesView** | Layout | Вид изменений: файлы + commit bar + diff/conflict |
| **useMenuActions** | Hook | Обработка действий из кастомного меню |
| **useKeyboardShortcuts** | Hook | Привязка клавиш (Ctrl+O, Ctrl+Shift+F, F5…) к действиям меню |
| **useOperationToasts** | Hook | Тост-уведомления о результатах git-операций |

## Что переиспользуется из SkyFork без изменений

- `GitParser.ts` — парсинг вывода git
- `GraphLayout.ts` — раскладка графа
- `OperationQueue.ts` — очередь операций
- `StateManager.ts` — управление состоянием

## Что адаптировано для Electron

| Модуль | Изменение |
|--------|-----------|
| Types | Убраны `readonly` модификаторы для совместимости с IPC-сериализацией |
| GitExecutor | Bundled git path, файловое логирование, поддержка `env` |
| AtomicWrite | Cleanup `.tmp-*` файлов, retry при rename |
| OperationJournal | Имя файла: `SkyFork-journal.json` |
| SafetyNet | Маркировка: `[SkyFork auto-stash]` |
| RecoveryManager | `dialog.showMessageBox` вместо `vscode.window` |
| FileWatcher | `chokidar` вместо `vscode.workspace.createFileSystemWatcher` |
| CommandHandler | Собственный diff (возвращает raw данные), ignoreWhitespace |
| ConflictParser | `writeFileSync` вместо `atomicWriteFileSync` для рабочих файлов |
| ContextMenu | CSS-переменные `--sg-*`, подтверждения для опасных действий |
| Messages | 45+ команд, 30+ событий (SSH, settings, shell actions) |
| IPC Bridge | Mapped types `HandlerTable`, `CmdOf<K>`, операции с operationEnd |

## Что написано с нуля для Electron

| Модуль | Описание |
|--------|----------|
| main.ts | Точка входа Electron, lifecycle, `Menu.setApplicationMenu(null)` |
| IPC Bridge | Electron IPC (ipcMain/ipcRenderer) вместо postMessage |
| Preload | contextBridge.exposeInMainWorld (`invoke`, `onEvent`, `platform`) |
| MenuBar | Кастомное HTML/CSS меню в рендерере (File, Edit, View, Repository, Branch, Help) |
| TitleBar | Заголовок окна с интегрированным меню |
| Diff Viewer | Собственный diff-рендерер (inline + split) |
| Merge Editor | ConflictPanel + MergeEditor с двухколоночным UI |
| SSH Manager | Генерация, просмотр, удаление SSH-ключей |
| Repo Settings | Настройки user.name/email с global/local toggle |
| Keyboard Shortcuts | Хук `useKeyboardShortcuts` — привязка горячих клавиш к действиям |
| Error Boundary | React ErrorBoundary для защиты от белого экрана |
| Toast System | Уведомления о результатах операций |

## Принцип безопасности: 5 уровней защиты

1. Git reflog (встроенный, 90 дней)
2. Auto-stash незакоммиченных изменений
3. Сохранение HEAD hash для rollback
4. Write-Ahead Log журнал операций
5. RecoveryManager при старте — обнаружение аномалий
