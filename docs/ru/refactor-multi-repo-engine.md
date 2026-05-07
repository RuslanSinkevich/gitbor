# Рефакторинг: multi-repo engine в main

> **Статус: реализован.** Документ оставлен как контекст «зачем мы это делали» и краткий отчёт «что в итоге получилось». Если планируешь дальнейшие изменения — сверь с `architecture.md` (там актуальное состояние).
>
> **Что фактически реализовано:**
> - Этап 1 (per-repo `GitExecutor`) — `RepoServicesRegistry` живёт в `src/core/services/RepoServicesRegistry.ts`.
> - Этап 2 (`RepoState` per-repo) — `RepoSlice` в `src/core/state/repoSlice.ts`, `slicesByRepo` в `StateManager`.
> - Этап 3 (UI-роль активного репо) — `meta` живёт в `useAppState` (`isOperationRunning`/`currentOperation` теперь производные от per-repo `runningOpsByRepo`).
> - Этап 4 (worker threads) — `WorkerPool` (`src/core/workers/WorkerPool.ts`) офлоадит `parseStatus`/`parseCommits`/`computeGraphLayout` по порогам размера.
> - Этап 5 — параллельный refresh уже работает (per-repo `OperationQueue`); глобального семафора пока нет, добавится при необходимости.
> - Этап 6 — `FileWatcher` per-repo с гардом dangerous paths и race-guard'ом против close во время async pre-scan.
>
> **Дополнительно реализовано (не было в исходном плане):**
> - `AppError` + `code`/`data` в `error`-event для локализации сообщений из main.
> - Per-repo фильтрация журнала git-активности (`useGitActivity(filterRepoPath)`).
> - Дедуп `graphData` по ссылкам в `MessageBridge.sentGraphByRepo`.
> - `isRepoTracked` гард во всех `refresh*` методах StateManager — не даёт фоновому refresh-у пересоздать сервисы закрытого репо.
> - **Декомпозиция god-модулей** (коммит `1ee36ed`): `StateManager` (683 → 179 строк) разбит на фасад над `RepoSlicesStore` + `RepoStateRefresher` + `RepoEventBus`; `useAppState` (435 → 158 строк) разбит на `useRepoSlices` + `useRunningOps` + `useStateSubscription`. Публичный API в обоих случаях не менялся.
> - **AI-модуль** (коммиты `1192090`, `e2cf65c`, `e255f34`): провайдеры `OpenAiCompatibleProvider` и `QwenWebProvider`, `AiConfigStore` с шифрованием через `safeStorage`, `AiHandlers` с per-`requestId` `AbortController` и маскированием секретов, IPC-хендлеры в `bridge/ipc/handlersAi.ts`, UI с пресетами через optgroup-селект.

---

Архивный план (был черновиком до реализации):

## Цель

Убрать класс зависаний UI, вызванных тем, что main process выполняет тяжёлую работу одного репозитория на собственном thread'е. Любое медленное репо (например, `C:\Users\Admin` с 440k untracked) тормозит **весь** UI, включая другие открытые табы.

## Корень проблемы

В текущей архитектуре main — **singleton**:

- `StateManager.state` — единый «активный репо».
- `GitExecutor` — один на процесс, его cwd переключается через `setCwd` при смене репо.
- IPC `skyfork:command` обрабатывается синхронно в одном handler'е.
- Парсеры (`GitParser.parseStatus`, `computeGraphLayout`) — синхронные, выполняются на main thread.
- `execFile` callback ассемблирует stdout (десятки МБ для больших `git status`) тоже на main thread.

Следствия:
1. Пока main парсит крупный stdout — IPC заморожен → renderer не отвечает на клики.
2. Пока main ждёт inflight git одного репо — second repo ждёт за ним.
3. Renderer per-repo slices (см. `useAppState`) спасают от «вспышки чужих данных» в табе, но не спасают от заморозки самой IPC-шины.

Renderer уже отвязан от ожидания main: `switchRepo` не блокирует, slices работают. Дальнейшая оптимизация в renderer'е упирается в bottleneck в main.

## Целевая концепция

**main = пул независимых per-repo движков. main thread занимается только маршрутизацией IPC и публикацией событий.**

```
Renderer
   │ IPC (по repoPath)
   ▼
MultiRepoBus  ──►  RepoEngine(A)   GitExecutor(A) │ Worker(parse/layout)
                   RepoEngine(B)   GitExecutor(B) │ Worker(parse/layout)
                   RepoEngine(C)   GitExecutor(C) │ Worker(parse/layout)
```

Свойства:

- `RepoEngine` инкапсулирует одно репо: свой `GitExecutor` (с фиксированным cwd, без `setCwd`), свой `RepoState`, свой watcher, свой scheduler refresh'ей.
- Парсеры (`parseStatus`, `parseCommits`, `computeGraphLayout`) и любая обработка > ~5мс на batch — в `worker_threads`. main thread не парсит.
- IPC-команды от renderer'а имеют `repoPath` (в большинстве уже имеют через cwd) и роутятся в нужный `RepoEngine`. Один движок занят — это никак не задерживает другие.
- `MultiRepoBus` подписывается на события всех движков и шлёт renderer'у с `repoPath`. Renderer уже маршрутизирует по slices.
- Понятия «активный репо» в core нет. Активность — концепт UI, отвечает renderer.

## Поэтапный план (приоритет)

Каждый этап — самостоятельный коммит с зелёными тестами и сборкой. Откатываемо.

### Этап 1. Per-repo `GitExecutor`

- В `GitExecutor` запретить `setCwd` (устаревает). Один экземпляр = один cwd.
- `CommandHandler` и `StateManager` сейчас держат один глобальный `GitExecutor`. Заменить на `Map<repoPath, GitExecutor>`. Команды для конкретного репо берут его executor.
- `git.killAll()` — теперь убивает только процессы своего репо, а не всё в процессе.

Эффект: переключение репо больше не «глушит» git других репо. Один шаг к независимости.

### Этап 2. `RepoEngine` инкапсулирует state + refresher

- Завести `class RepoEngine { state: RepoState; git: GitExecutor; refresher: Refresher; watcher; ... }`.
- `StateManager` остаётся как «фасад»: `getEngine(repoPath)` + `getActiveEngine()` + `subscribe`. Внутри — `Map<repoPath, RepoEngine>`. Каждый движок уведомляет своих подписчиков; никаких пересечений.
- `MessageBridge` подписывается на все движки и шлёт события с `repoPath` (тип `graphData` уже несёт `repoPath`; добавить `stateUpdate` с явным `repoPath`).
- В `CommandHandler` команды берут движок по `cmd.repoPath` или `index → openRepos[index].path` (если index в команде). Команды без явной привязки — в активный (концепт активного остаётся как UI-хинт; см. ниже).

### Этап 3. Активный репо — это UI-роль, не источник истины

- Убрать `state.activeRepoIndex` / `state.repoPath` из `StateManager`. Они переезжают в renderer (уже по факту туда переехали через `meta` в `useAppState`).
- main больше не «переключает контекст». Renderer выбирает, что показывает.
- IPC-команды `switchRepo` упраздняются (или становятся no-op для совместимости).
- `openRepo`, `closeRepo` — операции над пулом движков.

### Этап 4. Worker threads для парсинга

- Создать `src/core/workers/parseStatus.worker.ts`, `src/core/workers/graphLayout.worker.ts` (Node `worker_threads`).
- В `RepoEngine` отдавать большие stdout в worker для парсинга. Возвращать готовый `RepoState` слайс. main thread не блокируется ни секунды.
- Порог: использовать worker, если `stdout.length > 256 KB` (status) или `commits.length > 2000` (layout). Маленькие — на main thread, чтобы не платить overhead.

### Этап 5. Параллельный refresh нескольких репо

- `Refresher` в каждом движке делает свою работу независимо. Открыли два больших репо — оба идут одновременно.
- Глобальный лимит параллельных git-процессов (например, 8) через семафор в `GitExecutor.run`, чтобы не перегружать диск.

### Этап 6. Watcher per-engine

- `FileWatcher` уже почти такой (Map<repoPath, WatcherPair>), но привязан к одному `StateManager`. Перенести его внутрь `RepoEngine`. Глобально остаётся только координатор lifecycle (open/close).
- Гард на огромный worktree (>5000 top-level) — оставляется. Перенести в `RepoEngine`.

## Что меняется в публичных интерфейсах

- IPC: `MainEvent.stateUpdate.data` получает обязательный `repoPath` (уже почти везде есть в `data`, надо просто гарантировать). `graphData` уже содержит `repoPath`.
- Renderer: `useAppState` уже работает по `repoPath`-роутингу. Дополнительной правки не требуется.
- Команды: `switchRepo` — deprecate; `openRepo` / `closeRepo` остаются.

## Что НЕ делаем

- Не выносим парсеры в WASM/нативу — `worker_threads` достаточно.
- Не вводим Redux/Zustand в renderer — текущий `useAppState` со slices решает задачу.
- Не пересобираем `GraphLayout` пакетом — отдельный модуль не требуется на этом этапе.

## Риски

- Worker threads на электроне — проверить, что транспилируется корректно (`tsc -p tsconfig.main.json`) и грузится в `app.isPackaged` режиме.
- `Map<repoPath, GitExecutor>` ломает текущие места, использующие `stateManager.getGit()` глобально (`main.ts`, recovery). Их надо переделать под «по запросу для конкретного репо».
- IPC-обратная совместимость с уже сохранённым localStorage (`lastActiveRepo`, `recentRepos`) — менять не надо, схемы те же.

## Дефиниция готовности

- Открытие `C:\Users\Admin` (440k untracked) **не вызывает** торможения других табов. Можно кликать, переключаться, читать историю любого другого открытого репо в это время.
- Перевключение между репо — 0мс на UI.
- На холодном открытии нового репо UI показывает skeleton-пусто, события догружают данные постепенно.
- main thread не парсит crap. Pure router + worker pool.
