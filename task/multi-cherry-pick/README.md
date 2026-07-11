# Множественный cherry-pick (JetBrains-style)

**Статус: готово (T1–T4). Ручной E2E на конфликте желателен перед merge.**

## 1. Цель

Дать пользователю выбрать несколько коммитов (в т.ч. не подряд), опционально
отфильтровав их по regexp, и применить их последовательно к текущей ветке.
При конфликте — остановиться, показать список конфликтных файлов, дать
разрешить каждый в существующем 3-панельном merge-редакторе, затем продолжить
последовательность (continue) / пропустить коммит (skip) / отменить всё (abort).

Референс — git-клиент в IDE JetBrains: фильтр по regexp + массовый выбор,
черипик по одному коммиту через git-секвенсер.

## 2. Что уже есть в кодовой базе (переиспользуем)

- **Одиночный cherry-pick**: `writeCommands.cherryPick` → `safeWrite` с
  `allowedErrorClasses: ['conflict']` (конфликт не считается ошибкой, rollback
  не делается). Меню: `commitMenuItems.ts` → `postCommand({type:'cherryPick', hash, mainline?})`.
- **Детект состояния**: `ConflictManager.detectConflictResolution()` уже
  распознаёт `CHERRY_PICK_HEAD` → `kind:'cherry-pick'`. `abortMerge()` для
  cherry-pick вызывает `git cherry-pick --abort`.
- **Баннер конфликта**: `MergeBanner.tsx` меняет заголовок по `kind`
  (`cherryPicking`). Показывается пока есть неразрешённые файлы.
- **3-панельный merge-editor**: `MergeEditor.tsx` + `useConflictResolution.ts`
  (ours/theirs/result, миникарта, навигация по конфликтам). Уже ровно то, что
  описал TAZAQ («слева, справа, итог»).
- **Список конфликтных файлов**: поток «Изменения» показывает конфликтные
  файлы, `ConflictPanel.tsx` для быстрого выбора стороны, дабл-клик/кнопка →
  merge-editor.
- **Поиск по графу**: `useGraphSearch.ts` — substring-матч по subject/author/hash
  + AI-режим. Тумблер режима уже есть (`aiMode`) — по образцу добавляем regexp.
- **Очередь операций**: `OperationQueue` сериализует write'ы — batch cherry-pick
  идёт как одна операция.

## 3. Ключевое архитектурное решение: нативный git-секвенсер

`git cherry-pick <h1> <h2> ... <hN>` — это уже последовательное применение по
одному коммиту с сохраняемым состоянием (`.git/sequencer/todo` + `done`). На
конфликте git останавливается, оставляя `CHERRY_PICK_HEAD` и секвенсер.
Резюме через `git cherry-pick --continue`, пропуск — `--skip`, откат всей
серии — `--abort`.

**Не пишем свой цикл по коммитам в JS.** Причины:
- git сам держит порядок, состояние и резюме — меньше кода и багов;
- откат/скип уже семантически корректны на стороне git;
- `detectConflictResolution()` уже видит `CHERRY_PICK_HEAD`.

Единственная тонкость: после разрешения конфликта нельзя завершать через
обычный `git commit` (как делает `completeMerge`) — он закоммитит текущий pick,
но НЕ продвинет секвенсер к следующему коммиту. Нужен отдельный
`git cherry-pick --continue`. Поэтому в UI для `kind:'cherry-pick'` при наличии
остатка в секвенсере кнопка завершения должна слать `cherryPickContinue`,
а не `completeMerge`.

### Порядок коммитов

Секвенсеру важен порядок: применяем от предка к потомку (старые → новые).
`state.commits` идёт в topo-порядке новыми вперёд. Значит отсортировать
выбранные хэши по убыванию их индекса в `commits` (или собрать по индексам и
развернуть). Сортировку делаем в renderer перед отправкой команды (там есть
массив `commits`), передаём в backend уже упорядоченный список.

### Пустые коммиты

Коммит может стать пустым после применения (изменения уже в ветке). git
остановится с "The previous cherry-pick is now empty". Стратегия по умолчанию:
`git cherry-pick --empty=drop <hashes...>` (git ≥ 2.45) — пропускать пустые
автоматически. Фолбэк для старых git: ловим это состояние и предлагаем в UI
кнопку Skip. Флаг версии git можно не проверять — если `--empty` не поддержан,
git вернёт ошибку разбора аргумента; тогда повторяем без флага (см. таск T1).

## 4. Изменения по слоям

### 4.1 Backend (core)

- `src/core/bridge/messages.ts` — новые команды:
  - `{ type: 'cherryPickMany'; hashes: string[] }`
  - `{ type: 'cherryPickContinue' }`
  - `{ type: 'cherryPickSkip' }`
  - (abort — переиспользуем существующий `abortMerge`, он детектит cherry-pick)
  - Событие для прогресса: расширить `mergeState` или добавить
    `{ type:'cherryPickProgress'; done:number; total:number; remaining:string[] }`.
    Проще — добавить в `MergeState` необязательные поля `sequencerDone?`,
    `sequencerTotal?` и заполнять их в `getMergeState`.
- `src/core/commands/writeCommands.ts`:
  - `cherryPickMany(...)` — `safeWrite(..., 'cherry-pick', meta, ['cherry-pick','--empty=drop', ...hashes], ...)`.
    Если git не знает `--empty` — повтор без него.
  - `cherryPickContinue(...)` — по образцу `continueRebase`: НЕ через
    `safeWrite` (нет нужды в auto-stash), но с `allowedErrorClasses:['conflict']`,
    т.к. следующий pick может снова конфликтовать. Команда:
    `['cherry-pick','--continue']` с `GIT_EDITOR=true`/`--no-edit`-эквивалентом
    (для continue редактор не открывается если сообщение уже есть; на всякий
    случай выставить неинтерактивный редактор через env, как в других местах).
  - `cherryPickSkip(...)` — `['cherry-pick','--skip']`.
- `src/core/commands/CommandHandler.ts` — методы-обёртки `cherryPickMany`,
  `cherryPickContinue`, `cherryPickSkip` (по образцу строк 88-89).
- `src/core/commands/ConflictManager.ts` — метод чтения прогресса секвенсера:
  считать `.git/sequencer/todo` (кол-во оставшихся pick-строк) и `done`
  (сделано). Учесть worktree/`.git`-файл (в CommandHandler `git.getCwd()` +
  реальный git-dir; для секвенсера путь — `git rev-parse --git-path sequencer`).
- `src/core/bridge/ipc/handlersGitOps.ts` — хендлеры:
  - `cherryPickMany: op('cherry-pick', (cmd, ctx) => ctx.ch.cherryPickMany(cmd.hashes))`
  - `cherryPickContinue` / `cherryPickSkip` — по образцу `continueRebase`/`skipRebase`
    (строки 37-52): `operationStart` → runTracked → `operationEnd` →
    отправить свежий `mergeState`.
- `CONFLICTABLE_OPS` / `HEAD_DELTA_OPS` / `LONG_RUNNING_COMMANDS` уже включают
  `cherry-pick` — трогать не нужно.

### 4.2 Граф: мульти-выбор

- `src/renderer/src/features/graph/CommitGraph.tsx`:
  - Новые пропсы: `selectedHashes: Set<string>`, `onMultiSelect(hash, mode)` где
    `mode: 'toggle' | 'range' | 'single'`. Одиночный `selectedHash`/`onSelect`
    остаётся для панели деталей (клик без модификаторов).
  - В `onClick` строки (строка 279) разбирать `e.ctrlKey||e.metaKey` → toggle,
    `e.shiftKey` → range (от якоря до текущего индекса), иначе — single (сброс
    мульти-выбора + обычный `onSelect`).
  - Класс строки: добавить `s.rowMultiSelected` когда `selectedHashes.has(hash)`.
  - Обновить `memo`-компаратор (строки 356-364): добавить `selectedHashes`.
- Стейт мульти-выбора и «якоря» держать в `CommitsView.tsx` (или в хуке
  `useMultiSelect`), не в глобальном `AppState` — это чисто UI-состояние вкладки.
- CSS: `src/renderer/src/features/graph/*.module.css` — стиль `rowMultiSelected`
  (заметный, отличается от `rowSelected`).

### 4.3 Regexp-фильтр + «выбрать все совпадения»

- `src/renderer/src/features/graph/useGraphSearch.ts`:
  - Добавить режим `regexMode` (тумблер, по образцу `aiMode`). В `searchMatches`
    при `regexMode` компилировать `new RegExp(searchQuery, 'i')` в try/catch
    (невалидный regex → пустой матч + подсветка ошибки), матчить по
    `subject` (и опц. authorName).
  - Вернуть `matchedHashes` (все хэши совпадений, не только текущий индекс).
- UI поиска (в `CommitGraph.tsx`, блок вокруг строки 200): кнопка-тумблер
  «.*» (regexp) рядом с AI-тумблером и кнопка «Выбрать все» → заполняет
  `selectedHashes` всеми `matchedHashes`. Это и есть сценарий TAZAQ:
  «фильтрация по regexp + массовый черипик».

### 4.4 Контекст-меню и поток конфликтов

- `src/renderer/src/features/graph/commitMenuItems.ts`:
  - Новый параметр `selectedHashes?: string[]`. Если кликнутый коммит входит в
    мульти-выбор и `selectedHashes.length > 1` — пункт
    «Cherry-pick N коммитов» → `postCommand({type:'cherryPickMany', hashes})`
    (хэши уже отсортированы старые→новые в вызывающем коде).
  - Иначе — текущий одиночный пункт.
- `src/renderer/src/features/merge/MergeBanner.tsx`:
  - Когда `kind==='cherry-pick'` и есть остаток секвенсера
    (`sequencerTotal > sequencerDone`), показать прогресс «picked N/M» и кнопки
    **Continue** (`cherryPickContinue`, активна только когда все конфликты
    разрешены) / **Skip** (`cherryPickSkip`) / **Abort** (`abortMerge`).
  - Continue слать вместо `completeMerge` для cherry-pick-серии.
- i18n: `src/renderer/src/i18n/ru.ts` + `en.ts` — ключи
  `contextMenu.cherryPickMany`, `mergeBanner.cherryPickProgress`,
  `mergeBanner.continue`, `mergeBanner.skip`, тумблер regexp.

## 5. Поток пользователя (итог)

1. (Опц.) Ctrl+F → ввод regexp → тумблер «.*» → «Выбрать все».
2. Или вручную: Ctrl+клик / Shift+клик по коммитам в графе.
3. ПКМ → «Cherry-pick N коммитов».
4. Backend: `git cherry-pick --empty=drop <sorted...>`.
5. Нет конфликтов → готово, refresh графа.
6. Конфликт → баннер «Cherry-picking, picked 2/5», список конфликтных файлов
   во вкладке «Изменения», дабл-клик по файлу → 3-панельный merge-editor.
7. Разрешил все → Continue → `git cherry-pick --continue` → следующий pick.
   Снова конфликт → п.6. Или серия завершилась → refresh.
8. В любой момент: Skip (пропустить текущий коммит) / Abort (откатить всю серию).

## 6. Тесты

- `tests/commands/` — `cherryPickMany` применяет несколько коммитов по порядку;
  конфликт останавливает серию с `CHERRY_PICK_HEAD`; `continue` доводит до конца;
  `abort` откатывает всё; `--empty=drop` пропускает пустые (и фолбэк без флага).
- `tests/commands/ConflictManager.test.ts` — чтение прогресса секвенсера
  (todo/done).
- Renderer (если есть setup): сортировка выбранных хэшей старые→новые;
  разбор модификаторов клика (toggle/range/single); компиляция regexp с
  обработкой невалидного паттерна.

## 7. Разбивка на таски (для отдельных табов)

См. `tasks.md`. Порядок: T1 (backend) → T2 (мульти-выбор) → T3 (regexp) →
T4 (меню + поток конфликта). T1 самодостаточен и тестируется отдельно;
T2/T3 независимы друг от друга; T4 зависит от T1+T2 (и T3 для «выбрать все»).
