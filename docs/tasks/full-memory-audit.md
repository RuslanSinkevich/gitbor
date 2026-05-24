# Полный аудит утечек памяти

## Проблема

Ранее починена **главная** утечка — graph data неактивных табов не выгружалась (50k commits × N табов). Исправлено: eviction в `RepoSlicesStore`, `useRepoSlices`, `MessageBridge`; лимит снижен до 5000.

Но аудит был **точечным** — проверены 5–7 хотспотов по жалобе на graph. Десятки `useEffect`-подписок в renderer и несколько подсистем в main **не смотрены**. Heap-snapshot профилирование **не проводилось**. Утверждение «утечек нет» не подкреплено измерениями.

При длинных сессиях (2–4 часа) мелочи могут копиться и проявиться так же, как раньше копился graph.

### Предположительно не закрыто

- **useEffect-подписки в renderer** — `addEventListener`, `onMainEvent`, `setInterval` без корректного cleanup при unmount. Десятки штук не проверены.
- **Лёгкие поля slice'ов неактивных табов** — `branches`, `tags`, `stashes`, `remotes`, `stagedFiles` остаются в Map при switch. На 30+ табах × монорепо с тысячами веток — потенциально десятки MB без eviction.
- **`useRunningOps.runningOpsByRepo`** — Map чистится только на `repoClosed`. Ключ `''` (clone/init без репо) может застрять при cancel.
- **Recovery/Safety pipeline** — `RecoveryManager`, `SafetyNet`, `OperationJournal` — жизненный цикл кешей/бэкапов при длинной сессии не исследован.
- **Long-session baseline** — нет зафиксированных чисел за 2–4 часа работы. Нет heap snapshots.

## Цель

**Доказать измерениями** (не «по коду выглядит ок»), что за 4-часовую сессию память не растёт линейно. Каждый источник без upper bound — имеет bound, eviction или обоснование «не утечка» с числами.

## Scope

- Систематический audit всех `useEffect` с подписками в renderer — cleanup корректен или явно обоснован
- Lightweight slice eviction для неактивных табов (или доказательство что не нужно)
- Recovery/Safety/Journal — жизненный цикл кешей
- Long-session measurement: heap snapshots, RSS main + renderer за 2+ часа
- Зафиксировать числа в `docs/performance/memory-baseline.md`

## Критерии готовности

- Все `useEffect` с подписками проаудированы — каждый без cleanup поправлен или обоснован
- Long-session (2h, 5 репо, switch каждые 3–5 сек): RSS main + renderer **flat ±10%**
- Open/close 100 репо: RSS возвращается к baseline ±5%
- Heap snapshot после теста: нет detached DOM > 1000 nodes, нет дубликатов `RepoSlice`
- Числа зафиксированы

## Вне scope

- Переписывание на native / замена Electron
- Ручные вызовы GC через `--expose-gc`
- Graph rendering perf (отдельная задача)
- Оптимизация unrelated UI

## Связано

- `RepoSlicesStore.ts` — eviction graph data (уже сделано)
- `useRepoSlices.ts` — `evictInactiveGraphData`
- `MessageBridge.ts` — `sentGraphByRepo`, `cleanupRepo`
- `useOperationToasts.ts` — aggRef cleanup (уже сделано)
- `docs/performance/refresh-investigation.md`
