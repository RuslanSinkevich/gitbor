# SkyFork — Документация

## Обзор

SkyFork — standalone десктопный Git-клиент на Electron. Часть экосистемы Sky.
Бэкенд переиспользуется из SkyFork (VS Code extension) с адаптацией под Electron.

## Архитектура: 4 слоя

```
Renderer Process (React)  → UI: Sidebar, Graph, Changes, Detail, Merge
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
| 02 | [02-TYPES.md](02-TYPES.md) | types.ts | Git Layer | Без изменений |
| 03 | [03-GIT-EXECUTOR.md](03-GIT-EXECUTOR.md) | GitExecutor | Git Layer | Адаптирован (bundled git, логирование) |
| 04 | [04-GIT-PARSER.md](04-GIT-PARSER.md) | GitParser | Git Layer | Без изменений |
| 05 | [05-GRAPH-LAYOUT.md](05-GRAPH-LAYOUT.md) | GraphLayout | Git Layer | Без изменений |
| 06 | [06-ATOMIC-WRITE.md](06-ATOMIC-WRITE.md) | AtomicWrite | Safety Layer | Без изменений |
| 07 | [07-OPERATION-JOURNAL.md](07-OPERATION-JOURNAL.md) | OperationJournal (WAL) | Safety Layer | Переименование (SkyFork-journal) |
| 08 | [08-SAFETY-NET.md](08-SAFETY-NET.md) | SafetyNet | Safety Layer | Переименование (SkyFork auto-stash) |
| 09 | [09-OPERATION-QUEUE.md](09-OPERATION-QUEUE.md) | OperationQueue | Safety Layer | Без изменений |
| 10 | [10-RECOVERY-MANAGER.md](10-RECOVERY-MANAGER.md) | RecoveryManager | Safety Layer | Адаптирован (Electron dialog) |
| 11 | [11-STATE-MANAGER.md](11-STATE-MANAGER.md) | StateManager | Application Layer | Без изменений |
| 12 | [12-FILE-WATCHER.md](12-FILE-WATCHER.md) | FileWatcher | Application Layer | Адаптирован (chokidar вместо vscode.workspace) |
| 13 | [13-COMMAND-HANDLER.md](13-COMMAND-HANDLER.md) | CommandHandler | Application Layer | Адаптирован (собственный diff/merge) |
| 14 | [14-MESSAGES.md](14-MESSAGES.md) | messages.ts (IPC протокол) | Bridge Layer | Расширен (diff, системные команды) |
| 15 | [15-IPC-BRIDGE.md](15-IPC-BRIDGE.md) | IPC Bridge | Bridge Layer | Новый (заменяет MessageBridge) |
| 16 | [16-MAIN-PROCESS.md](16-MAIN-PROCESS.md) | main.ts (Electron) | Integration | Новый (заменяет extension.ts) |
| 17 | [17-CONFLICT-MANAGER.md](17-CONFLICT-MANAGER.md) | ConflictManager | Application + UI | Адаптирован (Monaco merge вместо VS Code) |
| 18 | [18-CONTEXT-MENUS.md](18-CONTEXT-MENUS.md) | Контекстные меню | UI | Адаптирован (CSS-переменные) |

## Что переиспользуется из SkyFork без изменений

- `types.ts` — все интерфейсы
- `GitParser.ts` — парсинг вывода git
- `GraphLayout.ts` — раскладка графа
- `AtomicWrite.ts` — атомарная запись
- `OperationQueue.ts` — очередь операций
- `StateManager.ts` — управление состоянием

## Что адаптировано для Electron

| Модуль | Изменение |
|--------|-----------|
| GitExecutor | Bundled git path, файловое логирование |
| OperationJournal | Имя файла: `SkyFork-journal.json` |
| SafetyNet | Маркировка: `[SkyFork auto-stash]` |
| RecoveryManager | `dialog.showMessageBox` вместо `vscode.window` |
| FileWatcher | `chokidar` вместо `vscode.workspace.createFileSystemWatcher` |
| CommandHandler | Собственный diff (возвращает raw данные для Monaco) |
| ConflictManager | Собственный three-way merge на Monaco |
| ContextMenu | CSS-переменные `--sg-*` вместо `--vscode-*` |

## Что написано с нуля для Electron

| Модуль | Описание |
|--------|----------|
| main.ts | Точка входа Electron, lifecycle, нативное меню |
| IPC Bridge | Electron IPC (ipcMain/ipcRenderer) вместо postMessage |
| Preload | contextBridge.exposeInMainWorld |
| Diff Viewer | Monaco Editor diff в Renderer |
| Merge Editor | Monaco three-way merge в Renderer |

## Порядок реализации

```
Этап 1: Скелет
  main.ts + preload + BrowserWindow + React scaffold

Этап 2: Git Layer (копируем из SkyFork)
  types.ts → GitExecutor → GitParser → GraphLayout

Этап 3: Safety Layer (копируем из SkyFork)
  AtomicWrite → OperationJournal → SafetyNet → OperationQueue → RecoveryManager

Этап 4: Application Layer
  StateManager → FileWatcher → CommandHandler → ConflictManager

Этап 5: Bridge Layer
  messages.ts → IPC Bridge

Этап 6: UI (React)
  Sidebar → Changes → Graph (Canvas) → Detail Panel → Diff (Monaco) → Merge

Этап 7: Полировка
  Нативное меню → Контекстные меню → i18n → Темы → electron-store
```

## Принцип безопасности: 5 уровней защиты

1. Git reflog (встроенный, 90 дней)
2. Auto-stash незакоммиченных изменений
3. Сохранение HEAD hash для rollback
4. Write-Ahead Log журнал операций
5. RecoveryManager при старте — обнаружение аномалий
