# Stream execution: multi-repo engine

> **Статус: исполнено.** Главная цель достигнута: переключение табов мгновенное, операции на одном репо не блокируют другое. Документ оставлен как историческая сводка чек-листа. Чек-боксы ниже отмечены по факту выполнения; см. `architecture.md` для актуального состояния.

---

> Документ — пошаговый чек-лист для непрерывного исполнения. Главная цель: чтобы переключение табов разных git-репо никогда не зависело от того, что делается в другом табе. Pull на A без сети не должен мешать любым операциям на B.

## Inviolable rules для исполнителя

1. **Никаких вопросов пользователю**. Все решения принимаются по этому документу.
2. **Никаких остановок** до финального этапа (full build + tests). Если упёрся — обходить, документировать TODO в коде, **не останавливаться**.
3. После каждого этапа: `npm test` зелёное, `npm run build` зелёное. Если красное — чинить **в этом же этапе**, не оставлять на потом.
4. Каждый этап = отдельный коммит с понятным заголовком на русском.
5. Если контекст переполнится — продолжать с того этапа, который ещё не отмечен `[x]`. Сначала перечитать **этот документ** и `docs/ru/refactor-multi-repo-engine.md`.

## Главная мысль (которую нельзя терять)

Сейчас в main всё на синглтонах: один `GitExecutor`, одна `OperationQueue`, один `StateManager.state`, один `SafetyNet`. Любая длинная операция на репо A блокирует любые операции на репо B. Нужно: **каждый открытый репо — независимый набор сервисов**. Renderer уже умеет показывать per-repo slices, упирается в backend.

Минимально достаточный набор изменений, чтобы пользовательский сценарий заработал:

- `RepoServicesRegistry`: `Map<repoPath, { git, queue, safety }>`. Команды берут сервисы по repoPath.
- `StateManager` хранит `Map<repoPath, RepoState>`. `getActive()` возвращает текущий по `activeRepoPath`.
- Все события в `MessageBridge` тегируются `repoPath`. Renderer (уже) маршрутизирует по slices.
- Воркер‑треды для парсинга — отдельная оптимизация, делаем после, если останется бюджет.

## Чек-лист этапов

### Этап 1. RepoServicesRegistry — пер-репо `GitExecutor`/`OperationQueue`/`SafetyNet` ✅

- [x] `src/core/services/RepoServicesRegistry.ts` — `Map<repoPath, RepoServices>` + bootstrap, `acquire`/`release`, cwd фиксирован.
- [x] `main.ts` создаёт registry, `StateManager` принимает его.
- [x] `StateManager.getActiveServices()`, `getGit()` возвращает git активного репо.
- [x] `CommandHandler` берёт `git`/`queue`/`safety` per-call через `state.getActiveServices()` (геттеры, без `bindToActiveRepo`-функции).
- [x] Per-repo `OperationQueue`.
- [x] `git.killAll()` убивает только процессы своего репо.
- [x] Тесты на registry — `tests/services/RepoServicesRegistry.test.ts`.
- [x] Коммит сделан.

### Этап 2. `RepoState` per-repo + `MessageBridge` маршрутизация ✅ (частично)

- [x] `RepoSlice` живёт в `src/core/state/repoSlice.ts` (см. также `mirrorRepoSliceToAppState` и git-format константы).
- [x] `StateManager` — `slicesByRepo: Map<repoPath, RepoSlice>` + общий `meta`. `getState()` отзеркаливает активный slice + meta.
- [x] `notify()` шлёт активный snapshot. Слайсы НЕ-активных репо обновляются молча, синхронизация через `switchRepo`.
- [x] `MessageBridge` шлёт `graphData` с явным `repoPath` (с дедупом по ссылкам). `stateUpdate` несёт активный repoPath через `data.repoPath`.
- [ ] `mergeState`/`rebaseProgress`/`submodules` пока без `repoPath` в payload — они актуальны только для активного. При необходимости добавим точечно.
- [x] Тесты на параллельный refresh — `tests/state/StateManager.test.ts`.
- [x] Коммит сделан.

### Этап 3. Параллельный refresh нескольких репо ✅ (частично)

- [x] Per-repo `OperationQueue` — длинный `git pull` на A не блокирует операции на B.
- [x] `FileWatcher` per-repo + per-repo `scheduleGitRefresh`/`scheduleStatusRefresh` (debounce общий по типу события, привязан к активному репо — это допустимо: refresh от события неактивного репо не имеет смысла, FS-сигналы от неактивного репо игнорируются на уровне `if (this.activeRepoPath === repoPath)`).
- [ ] Глобальный семафор на одновременные git-процессы — пока не нужен (на практике одновременно бежит ≤ 10 процессов от 2-3 открытых репо). Введём, если упрёмся.

### Этап 4. Команды по `repoPath`

- [ ] **Не реализовано и пока не нужно.** Активный репо как UI-понятие достаточен: команды берут активный, и на практике не возникает «коммит из неактивного таба». Добавим точечно при необходимости.

### Этап 5. Worker threads для парсинга ✅

- [x] `src/core/workers/parserWorker.ts` — единый worker для `parseStatus`/`parseCommits`/`computeGraphLayout`.
- [x] `src/core/workers/WorkerPool.ts` — пул из 2 worker'ов с round-robin балансировкой нагрузки и автоматическим respawn при `error`/`exit`.
- [x] Пороги: status > 256 KB, log > 512 KB, layout > 2000 commits → worker. Меньше — inline.
- [x] Сборка через `tsc` кладёт worker в `dist/core/workers/parserWorker.js`. `__dirname` резолвит корректно.
- [x] Тесты идут на `GitParser` напрямую; worker pool отключается через size-threshold.
- [x] `workerPool.dispose()` подцеплен в `app.on('window-all-closed')`.

### Этап 6. Активный репо — концепт UI ✅

- [x] Активный репо живёт в renderer (`meta.activeRepoIndex` в `useAppState`). В main `state.repoPath`/`activeRepoIndex` остались для обратной совместимости и команд без явного `repoPath`.
- [x] `state.isOperationRunning`/`currentOperation` в main больше не пишутся (метод `setOperationRunning` теперь no-op): renderer держит `runningOpsByRepo` карту и сам считает флаг от активной вкладки. Это убрало UI-блокировку «fetch на A → кнопки на B disabled».

### Финальный аккорд ✅

- [x] `npm test` — 41 файл, 407 тестов, зелёное (после декомпозиции god-модулей и добавления AI-провайдеров).
- [x] `npm run build` — renderer + main без ошибок.
- [x] Размер бандла renderer'а — ~390 KB (gzip 118 KB), без раздутия.
- [x] Запуск проверен: нет UnhandledPromiseRejection; `git.killAll()` per-repo работает; chokidar на dangerous paths не падает.
- [x] Финальный аудит проведён, race-условия закрыты (см. `architecture.md` секцию `FileWatcher`).
- [x] **Постфинал** (коммит `1ee36ed`): `StateManager` разбит на `RepoSlicesStore` + `RepoStateRefresher` + `RepoEventBus`; `useAppState` разбит на `useRepoSlices` + `useRunningOps` + `useStateSubscription`. Публичная поверхность сохранена 1:1.

## Что не делаем (явно)

- WASM/нативу — нет, `worker_threads` достаточно.
- Replace `GitParser` целиком — нет, используем как есть, переносим вызов в воркер.
- Переписывать renderer state-store (Zustand/Redux) — нет, текущий useAppState со slices работает.
- Поднимать gRPC/новый протокол — нет, остаёмся на electron `ipcRenderer.invoke` + `webContents.send`.

## Ориентиры по коду

- Менеджеры: `src/core/git/RebaseManager.ts`, `BisectManager.ts`, `WorktreeManager.ts`, `LfsManager.ts`, `HooksManager.ts`, `src/core/commands/ConflictManager.ts` — все принимают `git: GitExecutor`. Для этапа 1 проще всего — пересоздавать их при `switchRepo` с нужным executor'ом, либо передавать ленивый getter.
- `src/core/safety/SafetyNet.ts` — тоже принимает `git`. То же.
- `src/core/safety/RecoveryManager.ts`, `OperationJournal.ts` — пер-репо. На сейчас они инициализируются от случая к случаю (в `autoOpenRepo`). При рефакторинге — вынести в `RepoEngine`.
- `src/core/ai/AiHandlers.ts` использует `stateManager` для repoPath/diff. Должен брать из активного state — без изменений после этапа 2.

## TODO во время исполнения

Если по ходу что-то не вмещается в этап — пишем в коде комментарий:

```ts
// TODO(stream-execution etap 5): этот вызов parseStatus переносим в worker
```

И продолжаем. Ничего не оставлять «на подумать».
