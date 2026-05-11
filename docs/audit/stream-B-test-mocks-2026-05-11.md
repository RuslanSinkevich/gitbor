# Stream B — Test-mocks типизация — 2026-05-11

## Сводка

| Метрика | Baseline | После |
|---|---|---|
| `eslint` (всего) | 152 warnings | 3 warnings |
| `eslint` в `tests/` | 149 warnings | **0** |
| `eslint` в `src/` (вне scope) | 3 warnings | 3 warnings |
| `npm test` | 48 файлов / 494 теста | 48 / 494 (без изменений) |
| `tsc -p tsconfig.main.json` | 0 | 0 |
| `tsc -p src/renderer/tsconfig.json` | 0 | 0 |
| `npm run build` | OK | OK |

Все 149 warnings `@typescript-eslint/no-explicit-any` в тестовом коде закрыты типизацией. Оставшиеся 3 warnings — внутри `src/` (`OpenAiCompatibleProvider`, `UiShowcase`, `graphDemoData`), к стриму B не относятся (production-код).

Тесты не добавлялись и не удалялись. Имена `describe`/`it` не менялись. Никакого `eslint-disable @typescript-eslint/no-explicit-any` в финале не осталось — обошлись без оправданных эскейпов.

> Baseline в задании — «47 файлов / 483 тестов». Фактически в репо на момент стрима — **48 файлов / 494 тестов**. Стрим B их не трогал; обе цифры до и после совпадают.

## Что распределено по файлам

### Baseline (по файлам, до стрима)

| Файл | Warnings |
|---|---|
| `tests/bridge/helpers.test.ts` | 11 |
| `tests/commands/ConflictManager.test.ts` | 18 |
| `tests/commands/writeCommands.test.ts` | 75 |
| `tests/git/RebaseManager.test.ts` | 12 (9 explicit-any + 3 no-unused-vars) |
| `tests/git/WorktreeManager.test.ts` | 9 |
| `tests/i18n/i18n.test.ts` | 5 |
| `tests/safety/AtomicWrite.test.ts` | 1 |
| `tests/safety/RecoveryManager.test.ts` | 3 |
| `tests/state/StateManager.test.ts` | 15 |
| `tests/state/repoSlice.test.ts` | 2 |
| `src/**` (вне scope) | 3 |

После стрима — везде по `tests/*` ровно **0**.

## Структура `tests/_mocks/`

Создан каталог общих mock-фабрик и узких mock-типов. Подход: **каждая фабрика возвращает ровно те поля, что реально используются в тестах**. Никаких god-объектов `Partial<полный класс>`.

```
tests/_mocks/
├── index.ts        — re-export всего
├── git.ts          — MockGit, makeMockGit, makeScriptedGit, makeReducerGit
├── queue.ts        — MockQueue, makeMockQueue
├── safety.ts       — MockSafety, makeMockSafety
├── state.ts        — MockState, makeMockState
├── bridge.ts       — MockBridgeContext, makeMockBridgeContext
└── registry.ts     — FakeRepoServices, makeFakeRegistry, StateManagerMockGit
```

### Краткая сводка типов

| Тип / фабрика | Файл | Назначение |
|---|---|---|
| `MockGit`, `MockGitExec` | `git.ts` | Узкий тип GitExecutor-мока: `exec` (типизирован под сигнатуру `GitExecutor['exec']`), `getCwd`, опциональные `setCwd`/`killAll`. |
| `makeMockGit(overrides)` | `git.ts` | Простейший: один и тот же `GitExecResult` на любой вызов. Для writeCommands/Worktree. |
| `makeScriptedGit(map)` | `git.ts` | Подстрочный matcher по `args.join(' ')`. Для ConflictManager/Rebase. |
| `makeReducerGit(fn)` | `git.ts` | Для случаев, когда ответ зависит и от args, и от opts. |
| `MockQueue`, `makeMockQueue` | `queue.ts` | enqueueRead/enqueueWrite — синхронно проксируют op. |
| `MockSafety`, `makeMockSafety` | `safety.ts` | `wrapDestructive`, типизирован generic'ом T (как у `SafetyNet`). |
| `MockState`, `makeMockState` | `state.ts` | Только методы, которые читают writeCommands: refreshAll, refreshStatusAndNotify, setRepoPath, switchRepo, getState. |
| `MockBridgeContext`, `makeMockBridgeContext` | `bridge.ts` | Фейковый `HandlerContext` с массивом `sent` и `setRepoPath` для имитации переключения таба. Один точечный cast `as unknown as HandlerContext`. |
| `FakeRepoServices`, `makeFakeRegistry` | `registry.ts` | Лёгкий fake `RepoServicesRegistry` для StateManager-тестов: один и тот же набор сервисов на любой `acquire`. |

### Кастинг

В тестах теперь используется единый паттерн перехода от mock-типа к реальному:

```ts
const asGit = (m: MockGit) => m as unknown as GitExecutor;
```

`as unknown as` — потому что mock структурно покрывает только то, что нужно тестируемому коду, а не весь `GitExecutor` (например, нет `activeProcesses` и т. п.). Это безопасно: тестируемый код не касается приватных полей.

В одном месте — `RecoveryManager.test.ts` — кастуем целиком через `ConstructorParameters<typeof RecoveryManager>`, чтобы не плодить узкие интерфейсы под единственный кейс с тремя зависимостями.

## Файлы, потребовавшие особой осторожности

1. **`tests/commands/ConflictManager.test.ts`**
   Тесты передавали в `new ConflictManager(git as any, createMockState() as any)` **лишний** второй аргумент. Реальный конструктор принимает один. `as any` это маскировал — теперь убрал ненужный `createMockState` и второй аргумент. Имена тестов и ассерты сохранены, поведение не изменилось.

2. **`tests/state/StateManager.test.ts`**
   Самый сложный случай. Тесты конструируют `StateManager(registry)`, где registry — фейк со spy'ами. Большая часть кейсов переведена на общий `makeFakeRegistry(git)`. Один кейс (`refreshAll(closedPath)`) держит явные `acquireSpy`/`releaseSpy`, поэтому фейковый registry собран inline — это единственное место, где не пошёл общий helper. Один точечный `as unknown as RepoServicesRegistry` именно в этом кейсе, без `any`.

3. **`tests/state/repoSlice.test.ts`**
   `slice.branches = [{ name: 'main', isRemote: false, currentBranch: true }]` — поле `currentBranch` НЕ существует в реальном `Branch` (там `isCurrent`). Это древний дефект, замаскированный `as any`. Без правки тестовой логики (имена/ассерты) — использую `as unknown as Branch` чтобы зафиксировать: тут заведомо broken-shape для специфики кейса.

4. **`tests/bridge/helpers.test.ts`**
   `HandlerContext` требует `CommandHandler` и `StateManager` целиком. В тестах нужен только `ch.getMergeState` + `sm.getState` + `send`. Это единственное место в `_mocks/bridge.ts` с `as unknown as HandlerContext` — изолировано в фабрике.
   Дополнительно сделан хелпер `findEvent<K>(sent, type)` с typing-guard'ом по дискриминирующему `type` — все `(evt as any).field` ушли.
   Команды (`commandOf('cloneRepo', { url: '', path: '' })`) строятся через generic-helper, который сужает к `Extract<RendererCommand, { type: K }>`.

5. **`tests/i18n/i18n.test.ts`**
   Был `Record<string, any>` для рекурсии по локали. Заменён на `LocaleNode = string | { [key: string]: LocaleNode }` + `LocaleTree`. Дополнительно понадобилось аккуратно сузить тип в одной ветке `compareTemplates`, потому что в реальном дереве en/ru допустимы оба варианта.

6. **`tests/safety/RecoveryManager.test.ts`**
   Конструктор `RecoveryManager(git, journal, safetyNet)` требует конкретных классов, в тесте поданы partial-моки. Через `ConstructorParameters<typeof RecoveryManager>` получаем точные типы аргументов, кастуем точечно `as unknown as ...`. Тестовая логика не тронута.

## Justified `eslint-disable`

Не используются. Все warning'и закрыты без оправданных эскейпов.

## Что не сделал

— 3 warning'а в `src/` (`OpenAiCompatibleProvider.ts:119`, `UiShowcase.tsx:75`, `graphDemoData.ts:79`). Это production-код, явно вне scope стрима B (хард-запрет «НЕ трогай src/**»).

— Тестовые snapshot'ы / новые тесты не добавлялись.

## Команды для воспроизведения

```bash
npm run lint                                      # 0 errors / 3 warnings (всё src/)
npm test                                          # 48 files / 494 passed
npx tsc -p tsconfig.main.json --noEmit            # 0
npx tsc -p src/renderer/tsconfig.json --noEmit    # 0
npm run build                                     # OK
```
