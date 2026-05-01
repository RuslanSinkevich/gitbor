# Stream execution: multi-repo engine

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

### Этап 1. RepoServicesRegistry — пер-репо `GitExecutor`/`OperationQueue`/`SafetyNet`

- [ ] Создать `src/core/services/RepoServicesRegistry.ts`. Хранит `Map<repoPath, RepoServices>` с lazy `acquire(repoPath)` и `release(repoPath)`. `RepoServices = { git, queue, safety }`. cwd `GitExecutor` фиксированный, `setCwd` не используется снаружи.
- [ ] `main.ts`: создаёт `RepoServicesRegistry`. `StateManager` принимает registry. Глобальный `GitExecutor` убирается из `initServices` (остаётся только бутстрапный для `checkGitAvailable`).
- [ ] `StateManager`:
  - Внутри `state.repoPath` остаётся как «активный репо», но git‑операции идут через `registry.acquire(this.state.repoPath).git` (не `this.git.setCwd`).
  - `getGit()` для совместимости возвращает git **активного** репо.
  - При `setRepoPath`/`switchRepo`/`closeRepo` соответственно `acquire`/`release` в registry.
- [ ] `CommandHandler`, `writeCommands`, `readCommands`, `ConflictManager`, `RebaseManager`, `BisectManager`, `WorktreeManager`, `LfsManager`, `HooksManager`: вместо инжектируемого `git` принимают `() => GitExecutor` (резолвер активного git) или `repoPath -> services`. Минимальный путь — оставить сигнатуры, но `commandHandler` при создании этих менеджеров отдаёт им активный git, и при `switchRepo` подменяет внутренний git у менеджеров. Реализуем функцию `commandHandler.bindToActiveRepo(repoPath)` которая вызывается из StateManager.onRepoSwitch.
- [ ] Очередь: `OperationQueue` — теперь на репо. `enqueueWrite` за‑lock'енное на одно репо не блокирует другое. Команды узнают свою очередь через services активного репо (либо через явный repoPath в команде, если есть).
- [ ] `git.killAll()` теперь убивает только процессы конкретного репо (registry знает per-repo executor).
- [ ] Тесты: `OperationQueue` тесты остаются. Добавить тест `RepoServicesRegistry` (acquire/release идемпотентность, isolation).
- [ ] Коммит: «изоляция per-repo сервисов: GitExecutor/OperationQueue/SafetyNet через registry».

### Этап 2. `RepoState` per-repo + `MessageBridge` маршрутизация

- [ ] Выделить `interface RepoState` (текущие per-repo поля без openRepos/active*/isOperationRunning/currentOperation). Поместить в `src/core/state/RepoState.ts`.
- [ ] `StateManager.state` → `Map<repoPath, RepoState>` + `meta` (openRepos, activeRepoPath, isOperationRunning, currentOperation). `getState(): AppState` собирает «активный» совместимо для существующих потребителей.
- [ ] `notify()` рассылает событие с `repoPath` и слайсом этого репо. Подписчик в `MessageBridge` может проверить, является ли это активным.
- [ ] `MessageBridge` шлёт `stateUpdate` всегда с явным `repoPath` в `data`. Renderer (`useAppState`) уже маршрутизирует по `data.repoPath`.
- [ ] `mergeState`, `rebaseProgress`, `submodules` — добавить `repoPath` в payload.
- [ ] Тесты: проверить, что параллельный refresh двух репо обновляет два независимых slice (через мок `git`).
- [ ] Коммит: «StateManager: per-repo RepoState и тэгирование событий repoPath».

### Этап 3. Параллельный refresh нескольких репо

- [ ] `RepoEngine` — лёгкая обёртка над `RepoState` + `RepoServices` + `Refresher`. `refreshAll(repoPath)` → `engine(repoPath).refreshAll()`.
- [ ] `FileWatcher` дёргает refresh нужного репо (по `activeRepoPath` или передавая repoPath в callback). Можно расширить watcher: на каждое репо — свой scheduler debounce. Сейчас watcher уже per-repo, но debounce общий — переделать на per-repo.
- [ ] Глобальный семафор на одновременные git‑процессы (например, 8) в `RepoServicesRegistry` или в новом `GitProcessPool`, чтобы не утопить I/O при N открытых репо.
- [ ] Коммит: «параллельный refresh репо без блокировки соседей».

### Этап 4. Команды по `repoPath`

- [ ] Добавить опциональный `repoPath?: string` во все команды `RendererCommand`, относящиеся к чтению/записи (commit, stage, pull, push, fetch, checkout, branch ops, tag ops, log…). Если не указан — fallback на активный.
- [ ] `MessageBridge` маршрутизирует в нужные services. Команды без repoPath продолжают работать.
- [ ] Renderer пока **не использует** новый поле — добавим позже точечно для мест вроде «коммит из неактивного таба».
- [ ] Коммит: «команды поддерживают явный repoPath».

### Этап 5. Worker threads для парсинга

- [ ] `src/core/workers/parseStatus.worker.ts`: Node `worker_threads`. Принимает stdout, отдаёт `RepoStateStatus`.
- [ ] `src/core/workers/graphLayout.worker.ts`: принимает commits, отдаёт layout.
- [ ] Порог: `stdout.length > 256 KB` или `commits.length > 2000` → worker. Иначе main thread.
- [ ] Сборка: проверить, что воркер находится в `dist/main/workers/...` после `tsc`. Поправить `tsconfig.main.json` и `electron-builder.files` если нужно.
- [ ] Тесты: воркеры покрываются интеграционно — запустить через `Worker(...)` в test runner. Если в node:test/vitest сложно — мокать через прямой импорт чистой функции из воркера.
- [ ] Коммит: «парсинг status и graph layout в worker threads».

### Этап 6. Активный репо — концепт UI

- [ ] `IPC switchRepo` deprecate. На стороне main — становится no-op (логирует и игнорит). Renderer уже не зависит от ответа.
- [ ] `state.activeRepoPath` в core оставить только для совместимости с местами, где sense'а активного быть должно (recovery dialog, например). Свести к минимуму.
- [ ] Коммит: «switchRepo IPC deprecated, активный репо — UI-концепт».

### Финальный аккорд

- [ ] `npm test` — зелёное.
- [ ] `npm run build` — зелёное.
- [ ] Проверить размер бандла renderer'а (минимально не должен раздуться > +10%).
- [ ] Запустить `npm run dev`, открыть лог: убедиться, что нет UnhandledPromiseRejection, что `git.killAll()` продолжает работать на per-repo режиме.
- [ ] Финальный коммит «доводка: проверка стабильности после рефакторинга» если есть ещё подкрутки.

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
