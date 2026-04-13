> English version: [docs/architecture.md](../architecture.md)

# Архитектура SkyFork

## Обзор

SkyFork — четырёхслойное приложение на Electron. Зависимости направлены только вниз.

## Слои

```
Renderer (React) → Preload (contextBridge) → Main (Node.js) → Git binary
```

- **Renderer** — React 18, Vite, CSS Modules. Папки фич: graph, sidebar, changes, diff, merge, blame, file-history, rebase, repo-manager, repo-tabs, toolbar, titlebar, layout, ssh, settings. Состояние ведётся хуками: `useAppState`, `useMenuActions`, `useOperationToasts`, `useDiffState`, `useTheme`, `useToasts`, `useContextMenu`.

- **Preload** — `contextBridge.exposeInMainWorld('skyForkAPI', …)` отдаёт в изолированный renderer `invoke`, `onEvent`, `setLang` и `platform`.

- **Main process** — Сервисы инициализируются в `main.ts`: `GitExecutor`, `StateManager`, `OperationQueue`, `SafetyNet`, `CommandHandler`, `MessageBridge`, `FileWatcher`. IPC обрабатывается через `MessageBridge`. Нативное меню скрыто (`autoHideMenuBar`), но клавиатурные ускорители сохранены.

- **Git** — Запускается дочерним процессом через `execFile('git', args)`. `GitExecutor` отвечает за выполнение, таймаут, передачу env и логирование.

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
| **GitExecutor** | Запуск Git через `execFile`, таймаут ~30 с, поддержка env, лог в файл. |
| **GitParser** | Чистые парсеры: `parseCommits`, `parseBranches`, `parseTags`, `parseStatus`, `parseFileChanges`. |
| **GraphLayout** | Распределение дорожек для раскладки графа коммитов. |
| **DiffParser** | Преобразует unified diff в `FileDiff` / `DiffHunk` / `DiffLine`. |
| **ConflictParser** | Разбор conflict markers для merge editor. |
| **GitConfig** | Чтение/запись `user.name`, `user.email` (local/global scope). |
| **StateManager** | Единый источник правды: branches, tags, stashes, remotes, status, commits, graph layout. Уведомляет подписчиков при изменениях. |
| **CommandHandler** | Оркестрирует работу с Git; делегирует в `readCommands` / `writeCommands`. |
| **MessageBridge** | Electron IPC: принимает `RendererCommand`, передаёт в `CommandHandler`, шлёт `MainEvent` в renderer. Строгая типизация через mapped types. |
| **OperationQueue** | Read-операции могут идти параллельно; write — сериализованы. |
| **SafetyNet** | Авто-stash перед рискованными операциями; откат при сбое. |
| **FileWatcher** | `chokidar` на `.git` и рабочее дерево; инициирует обновление состояния. |
| **SshKeyManager** | Список, генерация, удаление SSH-ключей в `~/.ssh/`. |

## Модули renderer

Папки возможностей в `src/renderer/src/features/`:

| Область | Содержимое |
|---------|------------|
| **graph/** | `CommitGraph` (virtualized), `CommitDetails`, `branchPaths`. |
| **sidebar/** | Sidebar: дерево веток, tags, stashes, remotes, submodules. |
| **changes/** | `LocalChanges` (tree), `CommitBar` (subject + description). |
| **diff/** | `DiffPanel`, `DiffView`, `DiffHunkView`, `DiffSideBySide`, `ImageDiff`. |
| **merge/** | `MergeDialog`, `MergeEditor`, `MergeBanner`, `ConflictPanel`. |
| **blame/** | `BlameView`. |
| **file-history/** | `FileHistory`. |
| **rebase/** | `RebaseEditor`. |
| **repo-manager/** | `RepoManager`, недавние репозитории. |
| **repo-tabs/** | Вкладки для нескольких репозиториев. |
| **toolbar/** | Fetch, Pull, Push, Stash. |
| **titlebar/** | `TitleBar` с кастомным компонентом `MenuBar`. |
| **layout/** | `CommitsView`, `ChangesView`, `RightPanelContent`. |
| **ssh/** | `SshKeysDialog` — UI управления SSH-ключами. |
| **settings/** | `RepoSettingsDialog` — настройки user.name/email репозитория. |

Кастомные хуки в `src/renderer/src/hooks/`:

| Хук | Назначение |
|-----|------------|
| **useAppState** | Глобальное состояние из main process, обработка IPC-событий. |
| **useMenuActions** | Единый обработчик для кастомного меню + клавиатурных ускорителей. |
| **useOperationToasts** | Автоматические тосты по результатам git-операций. |
| **useDiffState** | Управление текущим diff target (file + hash). |
| **useTheme** | Переключение тёмной/светлой темы с сохранением в localStorage. |
| **useToasts** | Очередь тост-уведомлений с автоскрытием. |
| **useContextMenu** | Состояние контекстного меню (позиция + пункты). |

## Протокол IPC

`RendererCommand` задаёт 45+ типов команд; `MainEvent` — 30+ типов событий. Канонические определения в `src/core/bridge/messages.ts`. Renderer импортирует типы из `src/renderer/src/types/index.ts`, который реэкспортирует из `@core/git/types` и `@core/bridge/messages`.

## Управление состоянием

`StateManager` в main process владеет полным `AppState`. При каждом значимом изменении отправляет снимок событием `stateUpdate`. Хук `useAppState` в renderer сливает эти данные с локальным состоянием React, чтобы UI оставался синхронным без дублирования логики Git в renderer.
