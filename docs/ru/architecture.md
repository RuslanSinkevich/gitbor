> English version: [docs/architecture.md](../architecture.md)

# Архитектура SkyFork

## Обзор

SkyFork — четырёхслойное приложение на Electron. Зависимости направлены только вниз.

## Слои

```
Renderer (React) → Preload (contextBridge) → Main (Node.js) → Git binary
```

- **Renderer** — React 18, Vite, CSS Modules. Папки фич: graph, sidebar, changes, diff, merge, blame, file-history, rebase, repo-manager, repo-tabs, toolbar, titlebar, layout, ssh, settings. Состояние ведётся хуками: `useAppState`, `useMenuActions`, `useKeyboardShortcuts`, `useOperationToasts`, `useDiffState`, `useTheme`, `useToasts`, `useContextMenu`.

- **Preload** — `contextBridge.exposeInMainWorld('skyForkAPI', …)` отдаёт в изолированный renderer `invoke`, `onEvent` и `platform`.

- **Main process** — Сервисы инициализируются в `main.ts`: `RepoServicesRegistry` (per-repo `GitExecutor` / `OperationQueue` / `SafetyNet`), `StateManager`, `CommandHandler`, `MessageBridge` (с разнесёнными хендлерами в `bridge/ipc/`), `FileWatcher`, `WorkerPool` для офлоада парсеров. IPC обрабатывается через `MessageBridge`. Нативное меню убрано — `Menu.setApplicationMenu(null)`. Все меню и шорткаты — в renderer.

- **Git** — Запускается дочерним процессом через `execFile('git', args)`. `GitExecutor` отвечает за выполнение, таймаут, передачу env и логирование. `cwd` фиксируется на конструкторе — на репо приходится свой `GitExecutor`, чтобы переключение активного репо не «таскало» один executor между путями.

## Поток данных

```
User clicks button in React
  → postCommand({ type: 'stageFile', file: 'src/app.ts' })
  → api.ts → window.skyForkAPI.invoke(command)
  → preload/index.ts → ipcRenderer.invoke('skyfork:command', command)
  → MessageBridge.handleCommand(command)
  → CommandHandler.stageFile('src/app.ts')
  → writeCommands.stageFile() → git.exec(['add', '--', 'src/app.ts'])
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
| **GitExecutor** | Запуск Git через `execFile`, таймаут ~30 с, поддержка env, лог в файл. Чувствительные аргументы (сообщения, пароли) редактируются через `sanitizeArgs`. `cwd` задаётся на конструкторе — переключение между репо происходит на уровне `RepoServicesRegistry`, а не `setCwd`. `killAll()` шлёт SIGTERM активным процессам только своего репо. |
| **RepoServicesRegistry** | Реестр per-repo сервисов: `Map<repoPath, { git, queue, safety }>` + bootstrap-набор для clone/init без открытого репо. `acquire(repoPath)` создаёт сервисы лениво, `release(repoPath)` убивает inflight процессы. Это разрывает глобальную сериализацию: длинный `git pull` на репо A не блокирует операции на репо B. |
| **GitParser** | Чистые парсеры: `parseCommits`, `parseBranches`, `parseTags`, `parseStatus`, `parseFileChanges`. Большие выводы (статус > 256 KB, log > 512 KB) офлоадятся в `WorkerPool`. |
| **GraphLayout** | Распределение дорожек для раскладки графа коммитов. Вычисляется в worker thread при `commits.length > 2000`. |
| **WorkerPool** | Пул `worker_threads` (2 worker'а, round-robin) для CPU-тяжёлых задач: `parseStatus`, `parseCommits`, `computeGraphLayout`. Маленькие inputs обрабатываются inline (порог по размеру). При `error`/нештатном `exit` slot удаляется и через `setImmediate` спаунится новый — мёртвый worker никогда не остаётся в пуле. |
| **DiffParser** | Преобразует unified diff в `FileDiff` / `DiffHunk` / `DiffLine`. |
| **ConflictParser** | Разбор conflict markers для merge editor. |
| **GitConfig** | Чтение/запись `user.name`, `user.email` (local/global scope). |
| **StateManager** | Источник правды per-repo: `slicesByRepo: Map<repoPath, RepoSlice>` + общий `meta` (`openRepos`, `activeRepoIndex`). Все `refresh*` методы принимают `repoPath` и обновляют конкретный slice; перед работой проверяется `isRepoTracked(repoPath)`, чтобы фоновый refresh не «оживил» только что закрытый репо. `switchRepo` мгновенно публикует cached slice через `mirrorSliceToState` + `notify`, тяжёлый refresh уходит в фон. |
| **repoSlice** | `RepoSlice` тип + `emptyRepoSlice` / `mirrorRepoSliceToAppState` / git-format константы (`GIT_LOG_FORMAT`, `GIT_REF_FORMAT`, `GIT_TAG_REF_FORMAT`, `GIT_STASH_FORMAT`) + `hashGitStdout` для дедупа `git log`. Вынесено из `StateManager` для чистоты. |
| **CommandHandler** | Оркестрирует работу с Git; делегирует в `readCommands` / `writeCommands`. Все исполнители (`git`/`queue`/`safety` + `RebaseManager`/`ConflictManager`/...) берутся per-call через `state.getActiveServices()` — никаких mutable polей класса с привязкой к одному репо. На `openRepo` бросается `AppError('repoErrors.notARepo', { path })` с локализационным кодом, если путь не Git-репо. |
| **MessageBridge** | Electron IPC: тонкая обёртка ~150 строк. Принимает `RendererCommand`, ищет хендлер в `ipcCommandHandlers` (агрегат из `bridge/ipc/handlersState.ts`, `handlersGitOps.ts`, `handlersRepoExtras.ts`, `handlersAi.ts`). Ловит `AppError` и шлёт `error`-event с `code`+`data` для локализации в renderer. Шлёт `graphData` с дедупом по ссылкам (`sentGraphByRepo`) — повторное переключение A→B→A не гонит мегабайты JSON через IPC. |
| **bridge/ipc/** | Подмодули IPC-хендлеров: `helpers.ts` (`runTracked`/`op`/`opWithPostMerge`/`errOnFail`/`mergeStateAfter`), `ready.ts`, `handlersState.ts` (lifecycle, diff/blame/history), `handlersGitOps.ts` (push/pull/fetch/commit/stage/merge/rebase), `handlersRepoExtras.ts` (LFS, worktrees, hooks, stats, bisect, repo-tabs, settings, SSH), `handlersAi.ts`. `op`/`opWithPostMerge` снимают `repoPath` ДО старта операции и шлют его в `operationStart`/`operationEnd`, чтобы переключение вкладки между событиями не сломало per-repo running-флаг. |
| **OperationQueue** | Per-repo: read-операции параллельно, write — сериализованы. Отдельная очередь на каждое репо означает, что блокировка одного репо не блокирует другое. |
| **SafetyNet** | Per-repo. Авто-stash перед рискованными операциями; откат при сбое. |
| **FileWatcher** | Per-repo `chokidar` watcher'ы (`.git` + worktree, создаются лениво через `setImmediate` с pre-scan). Worktree-watcher НЕ запускается при `isDangerousRepoRoot(path)` (домашка, корень диска, `C:\Windows`...) или при > 1000 top-level entries — иначе `EPERM`/`EACCES`-каскад на `AppData`/`OneDrive` рушит main. Чёткий race-guard: если репо закрыли пока async pre-scan ещё идёт — новые watcher'ы не создаются (или сразу закрываются). `chokidar.on('error')` глушит EPERM, depth=3, debounce: 50мс `.git`, 200мс worktree. |
| **repoPathGuard** | `isDangerousRepoRoot(path)` — проверка «опасности» пути (drive root / home / Windows / `Program Files` / `node_modules` / т.п.). Используется в `FileWatcher` для отключения worktree-watcher. Сам факт открытия таких папок больше не блокируется — пользователь может намеренно посмотреть на любую директорию. |
| **WorkerPool** | (см. выше) — отдельная строка осталась в группе вспомогательных. |
| **AppError** | Структурированная ошибка с локализационным кодом (`code`) и параметрами шаблона (`data`) + technical fallback. `MessageBridge` превращает в `error`-event с `code`/`data`; renderer переводит через `locale.repoErrors[code]` и интерполирует. Альтернатива «строкам на английском, которые не переведены». |
| **gitActivityStore** | Журнал git-операций (start/append/finish) с `repoPath` per entry. `activityContext.ts` использует `AsyncLocalStorage`, чтобы `GitExecutor.exec` мог привязать выполненную команду к активной операции без явной передачи id. Renderer фильтрует журнал по `repoPath` активной вкладки — каждое репо видит только свои операции. |
| **Logger** | Уровневое логирование (`silent`/`error`/`warn`/`info`/`debug`) с разделением stdout/stderr и опциональным `WriteStream` в `<userData>/logs/YYYY-MM-DD.log`. Singleton `mainLogger` — один источник уровня для всех модулей. `configureMainLogger({ isProduction })` настраивается из `main.ts` после `app.whenReady`: prod → `silent` (тишина и в console, и в файл), dev → `debug`. ENV `SKYFORK_LOG_LEVEL` перебивает дефолт — для дебага у юзера в собранной версии. Все случайные `console.warn/error` в core (FileWatcher, WorkerPool, AiService и т. п.) переведены на `mainLogger`. Прямой `console.error` остался только в `process.on('unhandledRejection'/'uncaughtException')` — это последний рубеж, который должен сработать ДО `configureMainLogger`. |
| **SshKeyManager** | Список, генерация, удаление SSH-ключей в `~/.ssh/`. Двухшаговая генерация (пароль не в argv). |
| **ReflogParser** | Парсит вывод `git reflog` в структурированные записи. |
| **BisectManager** | Управляет сессиями `git bisect`: start, good, bad, skip, reset. |
| **HooksManager** | Список, вкл/выкл (toggle), чтение содержимого git hooks. |
| **WorktreeManager** | Список, добавление, удаление git worktrees. |
| **LfsManager** | Статус Git LFS, track/untrack паттернов, список управляемых файлов. |
| **pathSecurity** | Валидация путей: `safePath` (traversal + symlink через `realpathSync.native` + регистронезависимость на Windows), `isSafeFilename`. |
| **AtomicWrite** | Атомарная запись через tmp+rename с fsync. Retry на Windows через `Atomics.wait` (без busy-spin). |

## Модули renderer

Папки возможностей в `src/renderer/src/features/`:

| Область | Содержимое |
|---------|------------|
| **graph/** | `CommitGraph` (virtualized), `CommitDetails`, `branchPaths`. |
| **sidebar/** | Sidebar: дерево веток, tags, stashes, remotes, submodules. |
| **changes/** | `LocalChanges` (tree), `CommitBar` (subject + description). |
| **diff/** | `DiffPanel`, `DiffView`, `DiffHunkView`, `DiffSideBySide`, `ImageDiff`. |
| **merge/** | `MergeDialog`, `MergeEditor`, `MergeBanner`, `ConflictPanel`. |
| — | **`AppDialogs.tsx`** — все модальные диалоги вынесены из `App.tsx` для разделения ответственности. |
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
| **reflog/** | `ReflogDialog`, `ReflogTable`, `ReflogRow`, `ActionBadge`. |
| **bisect/** | `BisectDialog`, `BisectStartForm`, `BisectActiveSession`. |
| **hooks/** | `HooksDialog`, `HookItem`. |
| **worktrees/** | `WorktreesDialog`, `WorktreeItem`, `AddWorktreeForm`. |
| **lfs/** | `LfsDialog`, `LfsPatternList`, `LfsFileList`. |
| **gitignore/** | `GitignoreDialog`, шаблоны. |

Кастомные хуки в `src/renderer/src/hooks/`:

| Хук | Назначение |
|-----|------------|
| **useAppState** | Глобальное состояние из main process, обработка IPC-событий. Смена языка вызывает ре-рендер через `configLang`. |
| **useMenuActions** | Единый обработчик для действий кастомного меню (dispatch по строке). |
| **useKeyboardShortcuts** | Привязка клавиш (Ctrl+O, Ctrl+Shift+F, F5 и т.д.) к действиям меню. Пропускает в input/textarea/contentEditable. |
| **useOperationToasts** | Автоматические тосты по результатам git-операций. |
| **useDiffState** | Управление текущим diff target (file + hash). |
| **useTheme** | Переключение тёмной/светлой темы с сохранением в localStorage. |
| **useToasts** | Очередь тост-уведомлений с автоскрытием. |
| **useContextMenu** | Состояние контекстного меню (позиция + пункты). |
| **useDialogs** | Централизованное состояние видимости диалогов (about, ssh, reflog, bisect, hooks, worktrees, lfs, gitignore). |

## Протокол IPC

`RendererCommand` задаёт 45+ типов команд; `MainEvent` — 30+ типов событий. Канонические определения в `src/core/bridge/messages.ts`. Renderer импортирует типы из `src/renderer/src/types/index.ts`, который реэкспортирует из `@core/git/types` и `@core/bridge/messages`.

## Управление состоянием

В main `StateManager` хранит per-repo срезы (`slicesByRepo`) и общий `meta` (`openRepos`, `activeRepoIndex`). При каждом значимом изменении активного репо в renderer уходит `stateUpdate` (без `commits`/`graphLayout` — они отдельно через `graphData` с `repoPath` и дедупом по ссылкам). Срезы НЕ-активных репо обновляются молча — когда юзер вернётся на вкладку, `switchRepo` мгновенно отзеркалит свежий slice.

В renderer `useAppState` тоже хранит per-repo: `slices: Map<repoPath, RepoSlice>` плюс глобальный `meta`. При смене вкладки UI мгновенно показывает срез нового репо (или пусто, если ещё не наполнено) — никаких полей чужого репо в state быть не может. Дополнительно:

- `runningOpsByRepo: Map<repoPath, operation>` — per-repo карта активных операций. `state.isOperationRunning` и `state.currentOperation` берутся ИСКЛЮЧИТЕЛЬНО от активной вкладки. Это решает «переключился на B пока fetch идёт на A — кнопки на B не должны быть disabled».
- `translateError(code, data, fallback)` — переводит `error`-events с локализационным кодом (`repoErrors.notARepo`, ...) через `t()` + `tpl()`. Если кода нет в локали — fallback на `message` от main.
- `GitActivityIndicator` / `GitActivityDialog` принимают `repoPath` как props и фильтруют snapshot по нему: на вкладке репо A не видно операций B, и наоборот.

## Логирование

Двухсторонняя система: main и renderer пишут логи только в dev-режиме. В production console молчит — пользователь не видит шума в DevTools, а собранный билд не сорит в системный stdout.

**Main** — `src/core/utils/Logger.ts`:

- Singleton `mainLogger` с уровнями `silent` < `error` < `warn` < `info` < `debug`. ERROR/WARN идут в `console.error` (stderr), DEBUG/INFO — в `console.log` (stdout).
- `configureMainLogger({ isProduction })` вызывается из `main.ts` после `app.whenReady`. По умолчанию: `app.isPackaged` → `silent`, dev → `debug`. ENV `SKYFORK_LOG_LEVEL=warn|info|debug|...` перебивает дефолт — удобно для дебага у пользователя в собранной версии без пересборки.
- Файл-лог `<userData>/logs/YYYY-MM-DD.log` открывается только при не-silent уровне (в prod не пишется ничего).
- Все случайные `console.warn/error` в core (FileWatcher, WorkerPool, handlersState, AiService, OpenAiCompatibleProvider, GitExecutor) переведены на `mainLogger`. Прямой `console.error` остался **только** в `process.on('unhandledRejection'/'uncaughtException')` — это последний рубеж, который должен сработать до `configureMainLogger`, поэтому привязывать его к logger'у нельзя.

**Renderer** — `src/renderer/src/shared/logger.ts`:

- Префикс `[SkyFork]`. Все методы (`debug`/`log`/`info`/`warn`/`error`) — no-op в production-сборке Vite (`import.meta.env.DEV === false`). В dev — обычные `console.*`.
- Используется в `api.ts` (IPC error/warn) и `ErrorBoundary.tsx` (UI краш). Реальные UI-ошибки идут через ErrorBoundary + IPC `error`-канал в main, где попадают в `mainLogger.error`.

**`perf.ts`** (main и renderer) — отдельный диагностический инструмент с собственным opt-in (`SKYFORK_PERF=1` / `window.__SKYFORK_PERF__ = true`). Не путать с системой логов: perf включается вручную для замеров.
