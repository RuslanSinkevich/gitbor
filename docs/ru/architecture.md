> English version: [docs/architecture.md](../architecture.md)

# Архитектура SkyFork

## Обзор

SkyFork — четырёхслойное приложение на Electron. Зависимости направлены только вниз.

## Слои

```
Renderer (React) → Preload (contextBridge) → Main (Node.js) → Git binary
```

- **Renderer** — React 18, Vite, CSS Modules. Возможности: graph, sidebar, changes, diff, merge, blame, file-history, rebase, repo-manager, repo-tabs, toolbar. Состояние ведётся хуком `useAppState`.

- **Preload** — `contextBridge.exposeInMainWorld('skyForkAPI', …)` отдаёт в изолированный renderer `invoke`, `onEvent`, `setLang` и `platform`.

- **Main process** — Сервисы инициализируются в `main.ts`: `GitExecutor`, `StateManager`, `OperationQueue`, `SafetyNet`, `CommandHandler`, `MessageBridge`, `FileWatcher`. IPC обрабатывается через `MessageBridge`.

- **Git** — Запускается дочерним процессом через `execFile('git', args)`. `GitExecutor` отвечает за выполнение, таймаут и логирование.

## Поток данных

```
User clicks button in React
  → postCommand({ type: 'stageFile', file: 'src/app.ts' })
  → api.ts → window.skyForkAPI.invoke(command)
  → preload/index.ts → ipcRenderer.invoke('skyfork:command', command)
  → MessageBridge.handleCommand(command)
  → CommandHandler.stageFile('src/app.ts')
  → writeCommands.stageFile() → git.exec(['add', 'src/app.ts'])
  → StateManager.refreshStatusAndNotify()
  → MessageBridge.send({ type: 'stateUpdate', data: newState })
  → preload → ipcRenderer.on('skyfork:event')
  → api.ts eventListeners → useAppState setState
  → React re-renders with new stagedFiles
```

## Модули core

Модули в `src/core/`:

| Модуль | Назначение |
|--------|------------|
| **GitExecutor** | Запуск Git через `execFile`, таймаут ~30 с, лог в файл. |
| **GitParser** | Чистые парсеры: `parseCommits`, `parseBranches`, `parseTags`, `parseStatus`, `parseFileChanges`. |
| **GraphLayout** | Распределение дорожек для раскладки графа коммитов. |
| **DiffParser** | Преобразует unified diff в `FileDiff` / `DiffHunk` / `DiffLine`. |
| **ConflictParser** | Разбор conflict markers для merge editor. |
| **StateManager** | Единый источник правды: branches, tags, stashes, remotes, status, commits, graph layout. Уведомляет подписчиков при изменениях. |
| **CommandHandler** | Оркестрирует работу с Git; делегирует в `readCommands` / `writeCommands`. |
| **MessageBridge** | Electron IPC: принимает `RendererCommand`, передаёт в `CommandHandler`, шлёт `MainEvent` в renderer. |
| **OperationQueue** | Read-операции могут идти параллельно; write — сериализованы. |
| **SafetyNet** | Авто-stash перед рискованными операциями; откат при сбое. |
| **FileWatcher** | `chokidar` на `.git` и рабочее дерево; инициирует обновление состояния. |

## Модули renderer

Папки возможностей в `src/renderer/src/features/`:

| Область | Содержимое |
|---------|------------|
| **graph/** | `CommitGraph` (virtualized), `CommitDetails`, `branchPaths`. |
| **sidebar/** | Sidebar: дерево веток, tags, stashes, remotes, submodules. |
| **changes/** | `LocalChanges` (tree), `CommitBar`. |
| **diff/** | `DiffPanel`, `DiffView`, `DiffHunkView`, `DiffSideBySide`, `ImageDiff`. |
| **merge/** | `MergeDialog`, `MergeEditor`, `MergeBanner`, `ConflictNotifyDialog`. |
| **blame/** | `BlameView`. |
| **file-history/** | `FileHistory`. |
| **rebase/** | `RebaseEditor`. |
| **repo-manager/** | `RepoManager`, недавние репозитории. |
| **repo-tabs/** | Вкладки для нескольких репозиториев. |
| **toolbar/** | Fetch, Pull, Push, Stash. |

## Протокол IPC

`RendererCommand` задаёт 35+ типов команд; `MainEvent` — 25+ типов событий. Канонические определения в `src/core/bridge/messages.ts` на стороне main; renderer дублирует контракт в `src/renderer/src/types/ipc.ts`.

## Управление состоянием

`StateManager` в main process владеет полным `AppState`. При каждом значимом изменении отправляет снимок событием `stateUpdate`. Хук `useAppState` в renderer сливает эти данные с локальным состоянием React, чтобы UI оставался синхронным без дублирования логики Git в renderer.
