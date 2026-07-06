# Multi cherry-pick — таски по табам

Каждый таск — отдельный таб/сессия. Формулировки самодостаточны: содержат
контекст, файлы, критерии готовности. Внутренняя зависимость указана.

---

## T1 — Backend: git-секвенсер для batch cherry-pick

**Зависимости: нет. Тестируется изолированно.**

### Контекст
Одиночный cherry-pick уже есть (`writeCommands.cherryPick`, `safeWrite` с
`allowedErrorClasses:['conflict']`). Нужна batch-версия поверх нативного
git-секвенсера: `git cherry-pick <h1..hN>` применяет по одному, на конфликте
останавливается с `CHERRY_PICK_HEAD` и `.git/sequencer/`. Резюме —
`--continue`, пропуск — `--skip`, откат — `--abort` (уже покрыт `abortMerge`).

### Задачи
1. `src/core/bridge/messages.ts`:
   - Добавить в `RendererCommandCore`:
     `{ type:'cherryPickMany'; hashes:string[] }`,
     `{ type:'cherryPickContinue' }`, `{ type:'cherryPickSkip' }`.
   - В `MergeState` (в `src/core/git/types/operations.ts`) добавить
     необязательные `sequencerDone?:number`, `sequencerTotal?:number`.
2. `src/core/commands/writeCommands.ts`:
   - `cherryPickMany(queue, git, safety, state, hashes)`:
     `safeWrite(..., 'cherry-pick', {count:String(hashes.length)},
     ['cherry-pick','--empty=drop', ...hashes], 'Cherry-pick failed')`.
     Если exit-код указывает на неизвестный флаг `--empty` (старый git) —
     повторить без `--empty=drop`.
   - `cherryPickContinue(queue, git, state)` — по образцу `continueRebase`
     (handlersGitOps строки 37-44), но команда `['cherry-pick','--continue']`
     с неинтерактивным редактором (env `GIT_EDITOR=true` или аналог из проекта),
     `allowedErrorClasses:['conflict']` (следующий pick может конфликтовать).
   - `cherryPickSkip(queue, git, state)` — `['cherry-pick','--skip']`.
3. `src/core/commands/CommandHandler.ts` — методы-обёртки (по образцу строк 88-89).
4. `src/core/commands/ConflictManager.ts` — метод `getSequencerProgress()`:
   путь секвенсера через `git rev-parse --git-path sequencer`; посчитать
   pick-строки в `todo` (осталось) и `done` (сделано); заполнять
   `sequencerDone/Total` в `getMergeState()`.
5. `src/core/bridge/ipc/handlersGitOps.ts`:
   - `cherryPickMany: op('cherry-pick', (cmd, ctx) => ctx.ch.cherryPickMany(cmd.hashes))`.
   - `cherryPickContinue` / `cherryPickSkip` — по образцу `continueRebase`/
     `skipRebase` (строки 37-52): operationStart → runTracked → operationEnd →
     отправить свежий `mergeState` (с прогрессом).

### Готово когда
- Юнит-тесты в `tests/commands/`: серия из 3 коммитов применяется по порядку;
  конфликт на 2-м останавливает с `CHERRY_PICK_HEAD`; continue доводит серию;
  abort откатывает всё; пустой коммит дропается (и фолбэк без `--empty`).
- `npm run lint` и `npm test` зелёные.

---

## T2 — Граф: мульти-выбор коммитов

**Зависимости: нет (UI-часть независима от T1).**

### Контекст
Граф сейчас одиночный: `selectedHash:string|null` + `onSelect(hash)` в
`CommitGraph.tsx`; строка кликается в `onClick` (строка 279). Родитель —
`CommitsView.tsx`, передаёт `state.selectedCommitHash`/`selectCommit`.

### Задачи
1. Хук `useMultiSelect` (в `features/graph/`) или локальный стейт в
   `CommitsView.tsx`: `selectedHashes:Set<string>`, `anchorHash:string|null`,
   методы `select(hash, mode)`, `clear()`, `selectMany(hashes)`.
2. `CommitGraph.tsx`:
   - Новые пропсы `selectedHashes:Set<string>` и
     `onMultiSelect(hash, mode:'toggle'|'range'|'single')`.
   - В `onClick` строки: `ctrl/meta` → `toggle`, `shift` → `range` (по индексам
     в `commits` от якоря до текущего), иначе → `single` (сброс мульти + обычный
     `onSelect` для панели деталей).
   - Класс `s.rowMultiSelected` при `selectedHashes.has(commit.hash)`.
   - Добавить `selectedHashes` в `memo`-компаратор (строки 356-364).
3. CSS в `features/graph/*.module.css`: `rowMultiSelected` (визуально отличим
   от `rowSelected` и `rowSearchMatch`).
4. `CommitsView.tsx`: прокинуть стейт в `CommitGraph`, сбрасывать мульти-выбор
   при смене репозитория (`state.repoPath`).

### Готово когда
- Ctrl/Cmd+клик добавляет/убирает коммит; Shift+клик выделяет диапазон;
  обычный клик сбрасывает мультивыбор и открывает детали.
- Выбранные строки визуально подсвечены. Lint зелёный.

---

## T3 — Граф: regexp-фильтр и «выбрать все совпадения»

**Зависимости: нет для фильтра; кнопка «выбрать все» использует API из T2.**

### Контекст
`useGraphSearch.ts` уже имеет substring-поиск и тумблер `aiMode`. Добавляем
тумблер regexp по тому же образцу. UI поиска — в `CommitGraph.tsx` (~строка 200).

### Задачи
1. `useGraphSearch.ts`:
   - Стейт `regexMode` + `toggleRegexMode` (по образцу `aiMode`/`toggleAiMode`).
   - В `searchMatches`: при `regexMode` компилировать `new RegExp(query,'i')`
     в try/catch; невалидный паттерн → пустой результат + флаг `regexError`.
     Матч по `subject` (минимум), опц. `authorName`.
   - Вернуть `matchedHashes:string[]` (все совпадения) и `regexMode`,
     `toggleRegexMode`, `regexError`.
2. `CommitGraph.tsx`: тумблер «.*» рядом с AI-тумблером; индикация ошибки
   regexp; кнопка «Выбрать все» → `onMultiSelect`-эквивалент `selectMany(matchedHashes)`
   (метод из T2). При отсутствии T2 — временно no-op/скрыть кнопку.
3. i18n: подписи тумблера/кнопки/ошибки в `ru.ts`+`en.ts`.

### Готово когда
- Тумблер regexp фильтрует по паттерну; невалидный regex не роняет UI.
- «Выбрать все» помещает все совпадения в мульти-выбор (после T2). Lint зелёный.

---

## T4 — Контекст-меню + поток конфликта cherry-pick-серии

**Зависимости: T1 (команды) + T2 (мульти-выбор). Для «N коммитов» желателен T3.**

### Контекст
Меню коммита — `commitMenuItems.ts`. Баннер конфликта — `MergeBanner.tsx`
(меняет заголовок по `kind`, для cherry-pick — `cherryPicking`). Завершение
merge сейчас идёт через `completeMerge`/commit — для cherry-pick-серии нужен
`cherryPickContinue`, чтобы секвенсер продвинулся к следующему коммиту.

### Задачи
1. `commitMenuItems.ts`:
   - Параметр `selectedHashes?:string[]`. Если кликнутый коммит в мульти-выборе
     и длина > 1 → пункт «Cherry-pick N коммитов» →
     `postCommand({type:'cherryPickMany', hashes})`, где `hashes` отсортированы
     старые→новые (сортировка по индексу в `commits` — делать в вызывающем коде,
     где есть массив commits).
   - Иначе — текущий одиночный пункт.
   - Прокинуть `selectedHashes` из `CommitGraph.tsx` (`onContextMenu`, строка 281).
2. `MergeBanner.tsx`:
   - При `kind==='cherry-pick'` и `sequencerTotal>sequencerDone` показать
     «picked {done}/{total}» и кнопки Continue / Skip / Abort.
   - Continue (`cherryPickContinue`) активна только когда все конфликты
     разрешены (`conflicted===0`); Skip → `cherryPickSkip`; Abort → `abortMerge`
     (с confirm, как сейчас).
   - Для одиночного cherry-pick без остатка секвенсера — поведение как раньше.
3. i18n: `contextMenu.cherryPickMany`, `mergeBanner.cherryPickProgress`,
   `mergeBanner.continue`, `mergeBanner.skip` в `ru.ts`+`en.ts`.

### Готово когда
- Мульти-выбор → «Cherry-pick N коммитов» применяет серию по порядку.
- Конфликт: баннер с прогрессом + список файлов + 3-панельный редактор (уже
  есть) + Continue/Skip/Abort работают, серия доходит до конца или откатывается.
- Lint/тесты зелёные.
