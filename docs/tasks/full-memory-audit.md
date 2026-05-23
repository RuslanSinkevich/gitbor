# Полный аудит утечек памяти

## Проблема

В предыдущем стриме починили **главную** утечку — `graph-memory-eviction`: 5–50 MB на каждый неактивный таб (commits + graphLayout) больше не накапливаются. Но аудит был **точечным**: проверены хотспоты по жалобе на graph + ручной обход 5–7 ключевых мест (GitActivityStore, OperationJournal, GitExecutor, AiHandlers, FileWatcher).

Этого недостаточно: десятки `useEffect`-подписок в renderer'е и несколько подсистем в main вообще не смотрены. Утверждение «утечек нет» **не подкреплено измерениями** — нет ни длинных сессионных тестов, ни heap-snapshot профилирования. Мелочи могут копиться часами и проявиться как «через 2 часа клиент тормозит» — точно так же, как раньше копился graph.

### Уже сделано (контекст)

- `RepoSlicesStore.evictGraphData(path)` + вызов из `StateManager.switchRepo` для всех неактивных репо.
- `useRepoSlices.evictInactiveGraphData(activeRepoPath)` + вызов из `useAppState.switchRepoFast`.
- `MessageBridge.sentGraphByRepo` чистится для неактивных при каждом `stateUpdate`.
- `PROGRESSIVE_FULL_LIMIT`: 50000 → 5000 (юзер не получает «всю историю» как side-effect open).

### Что осталось / не аудировано

**Известный мелкий leak:**

- **`useOperationToasts.aggRef`** — `useRef<Map>` с активными `setTimeout(10s)`. На unmount компонента ref не зачищается, активные timer'ы держат closure → bucket'ы и host-строки. Реально живёт ≤10s после unmount (закрытие окна / hot-reload в dev), микроразмер. Лёгкая правка: `useEffect` cleanup.

**Зоны без полного аудита:**

1. **Все renderer-side `useEffect` с подписками** (`addEventListener`, `onMainEvent`, `subscribe`). Десятки штук, не проверял что каждая возвращает корректный cleanup.
2. **«Лёгкие» поля slice'ов неактивных табов** — `branches`, `tags`, `stashes`, `remotes`, `stagedFiles`, `unstagedFiles`. Сейчас сознательно остаются для UX мгновенного переключения, но на 50 табах × monorepo это десятки MB. Eviction только графа — компромисс, верхней границы нет.
3. **`RecoveryManager`, `SafetyNet`** — пайплайны recovery, не смотрел жизненный цикл (backup state, savedState, journal entries).
4. **`useRunningOps.runningOpsByRepo`** — Map в renderer. Чистится только на `repoClosed` event. Если main сел без события (краш), ключи могут остаться. Также ключ `''` (clone/init без репо) может застрять при cancel.
5. **Long-session поведение** — нет данных за 2-4 часа активной работы. Memory может расти линейно по неисследованным веткам.
6. **DevTools профилирование** — heap snapshots, retainer paths, allocation timeline на профильных репо никогда не делались (или результаты не зафиксированы).

## Цель

После стрима:
- Доказать (не «убедиться по коду», а **измерить**), что за 4-часовую сессию с активной работой память не растёт линейно.
- Каждый источник, который растёт без bound'а, имеет либо bound, либо eviction-стратегию, либо обоснование «это не утечка» с пруфом.
- Список потенциальных утечек закрыт исчерпывающе, с пометкой «проверено» / «исправлено» / «не воспроизводится».

## Scope

### Этап 1. Микроутечки (быстрые правки, < 30 мин)

**1.1. `useOperationToasts.aggRef` cleanup**

Добавить `useEffect(() => () => { for (b of aggRef.current.values()) clearTimeout(b.timer); aggRef.current.clear(); }, [])` в хук.

**1.2. `useRunningOps.runningOpsByRepo` ключ `''`**

Проверить путь clone/init/cancel: ключ `''` должен корректно удаляться через `endOperation` при success И при cancel. Если cancel пропускает endOperation — добавить explicit cleanup.

**1.3. Eviction на `repoClosed` для main**

В `RepoSlicesStore.removeSlice` уже корректный путь. Проверить что `MessageBridge.cleanupRepo(closedPath)` вызывается на каждое close (не только UI close, но и failure-case при невалидном репо).

### Этап 2. Renderer effect cleanups (систематически)

Прогон по всем `useEffect`, которые делают:
- `addEventListener` (window, document, ref'ы) — есть `removeEventListener` в return
- `onMainEvent(...)` подписку — вызван `unsubscribe()` в return
- `setInterval` / `setTimeout` (где не завершается сам) — `clearInterval` / `clearTimeout` в return
- `new AbortController()` — `controller.abort()` в return или явный signal-проброс

Конкретные файлы для прогона (минимум):
- `src/renderer/src/hooks/*.ts` — все хуки.
- `src/renderer/src/features/*/use*.ts` и `*.tsx` верхнего уровня.
- `src/renderer/src/ui/Sg*.tsx` — overlay-компоненты с listener'ами на document (ContextMenu, Tooltip, Dialog).

Метод: `rg "addEventListener|onMainEvent|setInterval"` + ручной audit. Чек-лист: «есть ли cleanup, корректный ли он, deps в effect не вызывают повторных подписок без отписки».

### Этап 3. Lightweight slice eviction

**Гипотеза:** на 30+ табах накопленные `branches/tags/stashes/remotes` неактивных репо (особенно крупных монорепо с тысячами веток) дают десятки MB.

**План:**
1. Замерить размер slice'а профильного репо в JSON: `JSON.stringify(slice).length`. Если на тестовом 5K-веточном репо одна `branches` занимает ≥ 1 MB — кейс есть.
2. Ввести **lazy eviction** для неактивных slice'ов: после N минут (например 5) idle на табе очищать **всё** кроме `repoPath`/`repoName`. На возврате таба — refreshAll подгрузит за 200–500 мс.
3. Альтернатива (если eviction даёт UX-фриз) — LRU-cap на количество «полных» slice'ов: 3 последних активных таба держат всё, остальные только meta.
4. Аналогично в main `RepoSlicesStore`.

### Этап 4. Recovery / Safety / Journal pipeline

**Что проверить:**
- `RecoveryManager` — есть ли карта/массив pending recovery-issues, чистится ли после resolve. Если `recoveryIssues` в renderer-state не очищается на repoClosed — leak.
- `SafetyNet.savedStates` (если есть кеш) — auto-stash hashes, journal entry IDs, бэкапы. На длинной сессии с десятками операций может расти.
- `OperationJournal` — на диске, но в памяти кеша нет; всё ОК. Перепроверить.
- `LongPathSuggester` — singleton listener, отписка при выходе?

### Этап 5. Long-session test (главный пруф)

**Сценарий A — multi-repo switch:**
1. Открыть 5 репо, среди них 1 монорепо (10K+ commits).
2. Скрипт автоматически переключает табы каждые 3 секунды, делает refresh раз в 30 секунд, периодически stage/unstage файла.
3. Каждые 10 минут — heap snapshot через DevTools (или `process.memoryUsage()` лог).
4. Цель: за 2 часа RSS main + RSS renderer **не растут** более чем на ±10%. Графики плоские.

**Сценарий B — open/close cycle:**
1. Скрипт открывает репо, ждёт refreshAll, закрывает.
2. 100 итераций.
3. Цель: RSS после последнего close ≈ RSS после первого close.

**Сценарий C — error storm:**
1. Симулировать сетевой сбой (отрезать VPN), 50 попыток pull/fetch с ошибкой network/auth.
2. Цель: после восстановления сети — heap не вырос (агрегатор toast'ов не накопил bucket'ы, retry-команды не висят).

**Инструменты:**
- `chrome://inspect` для renderer.
- `--inspect` для main (`process.memoryUsage()`).
- `electron --enable-precise-memory-info` если нужны точные данные.
- Записать в `docs/performance/memory-baseline.md` числа до и после.

### Этап 6. DevTools профилирование

**Что искать в Heap Snapshot:**
- Detached DOM nodes (рендереры табов после close).
- Большие arrays/strings retained длинными цепочками closure'ов.
- Несколько одинаковых `RepoSlice` объектов в памяти после switch (должен быть один + evict'ы).
- Listener'ы в `Set`/`Map` после unmount (Set.size > 0 при отсутствии активных компонентов).

**Allocation Timeline:**
- Запись 60 секунд активного скролла графа на 5K репо. Аллокации должны быть стабильны, без линейного роста.

## Критерии готовности

### Жёсткие (must):

- [ ] `useOperationToasts.aggRef` имеет cleanup (Этап 1.1).
- [ ] Все `useEffect` в renderer прошли audit чек-листа (Этап 2). Каждый, у кого нет cleanup при наличии listener — поправлен или явно прокомментирован «cleanup не нужен потому что …».
- [ ] Сценарий A (multi-repo switch 2h): RSS main + renderer flat ±10%. Числа зафиксированы в `docs/performance/memory-baseline.md`.
- [ ] Сценарий B (open/close 100x): RSS возвращается к baseline ±5%.
- [ ] Сценарий C (error storm 50x): heap не растёт более чем на 5 MB.
- [ ] Heap snapshot после теста: нет detached DOM > 1000 nodes, нет дубликатов `RepoSlice`, listener-Set'ы пустые при идле.

### Желательные (should):

- [ ] Lightweight slice eviction (Этап 3) — реализован или явно отложен с обоснованием «на 30 табах прирост ≤ X MB, не приоритет».
- [ ] `RecoveryManager` / `SafetyNet` — путь жизненного цикла задокументирован в коде (jsdoc на полях-кешах).
- [ ] CI / smoke-сценарий на open/close 100x — запускается локально одной командой.

## Вне scope

- Переписывание архитектуры на native (это шутка масштаба).
- Замена Electron на Tauri / другой shell.
- Borrowed memory: tracking V8 internal pools, RSS shared с другими electron-окнами (если есть).
- Ускорение GC через `--expose-gc` ручные вызовы (это симптоматика, не лечение).
- Оптимизация unrelated UI / commit graph rendering perf.

## Связано

- `docs/tasks/graph-memory-eviction.md` — предыдущий стрим, основа.
- `docs/tasks/push-fetch-async-refresh.md` — смежно (deferHeavy, async refresh).
- `src/core/state/RepoSlicesStore.ts` — `evictGraphData`, `removeSlice`, `trackedRepoPaths`.
- `src/core/state/StateManager.ts:switchRepo` — eviction вызов.
- `src/core/bridge/MessageBridge.ts` — `sentGraphByRepo`, `cleanupRepo`.
- `src/renderer/src/hooks/useRepoSlices.ts:evictInactiveGraphData`.
- `src/renderer/src/hooks/useOperationToasts.ts:aggRef` — known leak.
- `docs/performance/refresh-investigation.md` — справка по refresh-pipeline.
- `docs/performance/memory-baseline.md` — **создать** в этом стриме (числа до/после).
