# Memory baseline & audit (2026-05-25)

## TL;DR

Полный systematic audit подсистем без long-session измерений: heap snapshots
2-4 ч сессии — отдельная задача и требует ручного прогона на реальном железе
с заведением артефактов. Этот документ фиксирует, что проверено в коде,
какие источники имеют bound и какие пограничные кейсы остались.

## Главная (уже решённая) утечка

`commits[] + graphLayout.nodes[]` неактивных табов — десятки MB на каждый
неактивный таб монорепо.

- **main:** `RepoSlicesStore.evictGraphData(path)` — вызывается из
  `StateManager.switchRepo` по всем `trackedRepoPaths()` кроме нового
  активного. Бампит `slice.token`, очищает `commits`/`graphLayout` и
  cache-метки.
- **renderer:** `useRepoSlices.evictInactiveGraphData(activePath)` —
  вызывается из `useAppState` после `setActiveRepoIndex`.
- **bridge:** `MessageBridge.sentGraphByRepo` — на switchRepo держит
  только активный путь (Map sweep), на repoClose явный `delete`.

Лимит истории: `PROGRESSIVE_FULL_LIMIT = 5000` коммитов
(`RepoStateRefresher`) — без него на монорепо тянуло до 50k.

## Audit useEffect / подписок (renderer)

Прошли все `useEffect` с потенциально утекающими подписками:

| Файл | Подписка | Cleanup |
|------|----------|---------|
| `useStateSubscription.ts` | `onMainEvent` главный listener | unsubscribe в return |
| `useAppUpdater.ts` | `onMainEvent` | ✓ |
| `useAutoFetch.ts` | `onMainEvent` + `setInterval` | ✓ |
| `useGitActivity.ts` | `onMainEvent` | ✓ |
| `DiffPanel.tsx` | `onMainEvent` + `setTimeout` | ✓ |
| `ConflictPanel.tsx` | `onMainEvent` | ✓ |
| `BlameView.tsx` | `onMainEvent` | ✓ |
| `FileHistory.tsx` | `onMainEvent` | ✓ |
| `MergeDialog.tsx` | 2× `onMainEvent` | ✓ |
| `RebaseEditor.tsx` | 2× `onMainEvent` | ✓ |
| `StatisticsDialog.tsx` | `onMainEvent` | ✓ |
| `ContributionHeatmap.tsx` | `onMainEvent` | ✓ |
| `ReflogDialog.tsx` | `onMainEvent` | ✓ |
| `HooksDialog.tsx` | `onMainEvent` | ✓ |
| `WorktreesDialog.tsx` | `onMainEvent` | ✓ |
| `LfsDialog.tsx` | `onMainEvent` | ✓ |
| `BisectDialog.tsx` | `onMainEvent` | ✓ |
| `RepoSettingsDialog.tsx` | `onMainEvent` | ✓ |
| `SshKeysDialog.tsx` | 2× `onMainEvent` + `setTimeout` | ✓ |
| `AiSettingsDialog.tsx` | `onMainEvent` + `addEventListener('keydown')` + `setTimeout` ref | ✓ |
| `AiGenerateButton.tsx` | `onMainEvent` (streaming chunks) | ✓ |
| `useAiConfig.ts` | `onMainEvent` | ✓ |
| `useConflictResolution.ts` | 2× `onMainEvent` | ✓ |
| `SubmodulesList.tsx` | `onMainEvent` | ✓ |
| `MenuBar.tsx` | 2× `addEventListener` (`keydown`, `mousedown`) | ✓ |
| `useKeyboardShortcuts.ts` | `addEventListener('keydown')` | ✓ |
| `SgContextMenu.tsx` | 2× `addEventListener` + 2× `setTimeout` ref | ✓ |
| `SgDialog.tsx` | `addEventListener('cancel')` | ✓ |
| `SgSplitPane.tsx` | 2× `addEventListener` (`mousemove`, `mouseup`) | ✓ |
| `SgToast.tsx` | `setTimeout` | ✓ |
| `SgTooltip.tsx` | `setTimeout` ref | ✓ |
| `useGraphSearch.ts` | `addEventListener('keydown')` | ✓ |
| `useVirtualScroll.ts` | `addEventListener('scroll')` | ✓ |
| `Toolbar.tsx` | `addEventListener('mousedown')` | ✓ |
| `CommitBar.tsx` | `addEventListener('resize')` + `setTimeout` | ✓ |
| `useToasts.ts` | timers per toast | ✓ |
| `useOperationToasts.ts` | `aggRef` timers + unmount cleanup | ✓ |

### Найденные проблемы → пофикшены

- **`App.handleConflictResolved`** — `onMainEvent` подписывался без
  таймаута, отписывался только когда придёт `mergeState`. Если main не
  пришлёт ответ (IPC drop / репо закрыли) — listener висит в глобальном
  массиве навсегда. Добавлен safety-таймаут 3 с.
- **`useRunningOps`** — ключ `''` (clone/init без репо) застревал
  навсегда, если операция не дослала `operationEnd`. Теперь любой
  `startOperation(repoPath, ...)` с непустым ключом сносит осиротевший
  `''` (одна запись, но защита от копящегося state).
- **`StateManager.notifyRepoClose`** — не звал
  `PreflightChecks.invalidateCache(closedPath)`. На длинной сессии с
  open/close десятков репо `PreflightChecks.okCache` копила записи.
  Теперь чистится явно.

## Lightweight slice fields (branches/tags/stashes/remotes/...)

Сейчас при switch evict'ятся только `commits` + `graphLayout`. Лёгкие
поля остаются.

| Поле | Размер на репо |
|------|----------------|
| `branches` | 1k-50k веток × ~80 байт = 80 KB – 4 MB |
| `tags` | сотни × ~50 байт = десятки KB |
| `stashes` | <20 × ~100 байт = ~2 KB |
| `remotes` | 1-3 × ~100 байт = почти ноль |
| `stagedFiles`/`unstagedFiles` | ≤100 × ~80 байт = ~8 KB |

Для типичного use (3-10 табов, обычные репо) — суммарно <1 MB на все
неактивные slice'ы. Eviction не нужен.

Для extreme case (30+ табов × монорепо vscode/chromium с 50k refs) — до
100-150 MB на все табы. Решение **не вкатано осознанно**: очистка
`branches` на switch = пустой sidebar до прихода рефреша, регрессия UX
заметнее, чем выигрыш памяти для редкого кейса. Если придёт жалоба —
вкатить «idle-eviction» (`branches`/`tags` чистить у репо, не активного
N минут) через `setTimeout` в `useRepoSlices`.

## Recovery / Safety / Journal

- **`OperationJournal`** — НЕТ in-memory кеша. Каждый `begin/complete/
  fail/cleanup` читает файл, мутирует, пишет атомарно. Disk-growth
  bounded `cleanup(maxAgeDays=7)`. ✓
- **`RecoveryManager`** — stateless относительно памяти (читает journal
  + ls-files). `incompleteStashHashes` создаётся в скоупе вызова. ✓
- **`SafetyNet`** — не держит growing structures (проверено: только
  `OperationQueue.listeners` Set, описан ниже).
- **`SafetyStats`** — `cached: SafetyStatsFile` (один объект на процесс),
  поля — счётчики Record<string, number>. Bounded. ✓
- **`OperationQueue.listeners`** — `Set<StatusListener>` для статуса
  очереди. Подписчики — UI (`useStateSubscription` и др.), все с
  unsubscribe в cleanup. Не растёт. ✓
- **`PreflightChecks.okCache`** — static `Map`, ключ
  `repoPath|op|dirty`. Записи с TTL 500 мс перетираются. На repoClose
  теперь явно инвалидируется (см. выше).

## Что НЕ закрыто этим аудитом

Долгие сессии без heap-snapshot'а — не подтверждены измерениями. Чтобы
получить boundless-числа, нужен ручной прогон:

1. `npm run dev` или packaged build.
2. Открыть 5 средних репо, переключаться каждые 3-5 с в течение 2 ч.
3. DevTools → Memory → Allocation timeline / Heap snapshot.
4. Зафиксировать RSS main + renderer в начале и в конце.
5. Цели:
   - RSS flat ±10% за 2 ч.
   - 100 циклов open/close: возврат к baseline ±5%.
   - Heap snapshot: нет дублей `RepoSlice` сверх открытых табов, нет
     detached DOM >1k.

Когда такой прогон будет сделан — числа сюда же.
