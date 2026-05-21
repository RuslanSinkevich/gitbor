# Задача: переработать обработку ошибок git-операций в GitBor

> **Этот документ — стартовый промпт для нового агентского таба.**
> Скопируй целиком и вставь в новый чат, чтобы агент начал работу со свежим контекстом.

---

## Контекст проблемы

При merge ветки `stage` GitBor упал с ошибкой:

```
error: Unable to create 'C:/Users/Admin/ConsumerCRM-old-techpris/.git/index.lock': File exists.
Another git process seems to be running in this repository...
fatal: Unable to write index.
```

Параллельный git-процесс держал `index.lock`. `SafetyNet` слепо запустил auto-rollback (`reset --hard` + `stash pop`), `stash pop` упал на тот же lock. Юзер увидел "всё пропало", хотя stash был жив (`stash@{0} = 27e5e919...`).

**Главные дефекты текущей реализации:**

1. **Авто-rollback на любую ошибку** (`SafetyNet.ts:79-91`) — включая транзитные (lock) и конфликты. Сам rollback падает на ту же причину.
2. **Нет различия классов ошибок** — `merge failed: <stderr>` без разбора.
3. **Нет pre-flight** — операция стартует даже если `index.lock` уже висит / `MERGE_HEAD` есть.
4. **`tryRestoreAutoStash` через `stash pop`** — pop падает на других причинах (например lock), потеря feedback'а юзеру.
5. **Merge без разделения "конфликт" vs "ошибка"** — `safeWrite` бросает `GitError` на любой `exitCode !== 0`.

## Проект

- Путь: `d:\Users\Admin\Desktop\Skycode\gitbor`
- Stack: Electron + React + TypeScript + Vite, vitest для тестов, Playwright для e2e
- Структура: `src/main/`, `src/core/`, `src/preload/`, `src/renderer/`, `tests/`, `tests-e2e/`
- Бренд: GitBor (форк git-клиента)

## Что уже есть в коде (НЕ переписываем — расширяем)

- `src/core/safety/SafetyNet.ts` — `wrapDestructive(opName, params, operation, options)` с auto-stash + auto-rollback
- `src/core/safety/RecoveryManager.ts` — startup-recovery; уже умеет auto-cleanup stale `index.lock` ≥15s
- `src/core/safety/RecoveryUI.ts` — native Electron `dialog.showMessageBox` для startup recovery
- `src/core/safety/RecoveryUI.locales.ts` — паттерн локализации main-side (en/ru)
- `src/core/safety/OperationJournal.ts` — журнал операций для recovery
- `src/core/safety/OperationQueue.ts` — очередь read/write per-repo
- `src/core/git/GitExecutor.ts` — `exec(args, opts)` + класс `GitError`
- `src/core/commands/writeCommands.ts` — `safeWrite` обёртка над `wrapDestructive`
- `src/core/commands/ConflictManager.ts` — merge с возвратом `{ success: false, conflicts: [...] }` (НЕ throw, корректно)
- `src/core/bridge/messages.ts` — типы IPC (`RendererCommand`, `MainEvent`), события `operationStart`/`operationEnd`
- `src/core/bridge/ipc/handlersGitOps.ts` — хендлеры через `op()` / `opWithPostMerge()` обёртки
- `src/renderer/src/ui/SgPromptDialog.tsx` + `SgDialog.tsx` — стиль-референс для SafetyDialog
- `src/renderer/src/hooks/useOperationToasts.ts` — toast по `lastOpResult`
- `src/renderer/src/hooks/useRunningOps.ts` — тип `OperationResult { operation, success, error }`
- `src/renderer/src/hooks/useStateSubscription.ts` — единый `onMainEvent` listener
- `src/renderer/src/AppDialogs.tsx` — реестр lazy-load модалов

Существующий узкий план: `c:\Users\Admin\.cursor\plans\safety-error-handling_3ad6d362.plan.md`. В этом документе — расширенный скоуп (делаем всё).

## Архитектура решения

```
UI (Renderer)          IPC          WriteCommand       Preflight    SafetyNet         Classifier      Git
   |                    |                |                  |             |                 |           |
   | merge(branch) -->  |                |                  |             |                 |           |
   |                    | ch.startMerge->|                  |             |                 |           |
   |                    |                |   check(op) ---> |             |                 |           |
   |                    |                |   issues? -> safetyIssue → UI ждёт выбор         |           |
   |                    |                | wrapDestructive(allowedErrorClasses=['conflict'])----->     |
   |                    |                |                  |             | stash push ---------->     |
   |                    |                |                  |             | merge ----------------->   |
   |                    |                |                  |             | exitCode != 0?             |
   |                    |                |                  |             | classify(stderr)->class    |
   |                    |                |                  |             | conflict (merge) → success:false, conflicts:[] (НЕТ rollback)
   |                    |                |                  |             | transient/unknown → OperationFailure (НЕТ rollback)
   |                    |                | <-----------------------       |                 |           |
   |                    | operationEnd { errorClass, savedState, suggestedActions } <----    |           |
   | useOperationToasts видит errorClass → НЕ показывает toast                                          |
   | useSafetyDialog открывает SafetyDialog с кнопками действий                                         |
   | юзер выбирает → postCommand → выполнение (stashApply / resetTo / retry / abortMerge / ...)         |
```

**Инвариант:** rollback и stash-pop делает только пользователь через UI. Бэкенд готовит варианты, не принимает решения.

## Полный скоуп (16 блоков, без отсечений)

### Блок 1. Типы и контракты

- `src/core/git/types/errors.ts`:
  - `GitErrorClass = 'lock_held' | 'conflict' | 'dirty_tree' | 'merge_in_progress' | 'rebase_in_progress' | 'network' | 'auth' | 'non_fast_forward' | 'untracked_overwrite' | 'preflight_blocked' | 'unknown'`
  - `ClassifiedError { class: GitErrorClass; recoverable: boolean; hint?: string; rawStderr: string }`
  - `SuggestedAction = { kind: 'retry' | 'restore_stash' | 'apply_stash_only' | 'drop_stash' | 'kill_git_process' | 'remove_lock' | 'rollback' | 'abort_merge' | 'continue_merge' | 'abort_rebase' | 'manual_continue' | 'ignore' | 'cancel'; label?: string; payload?: Record<string, string> }`
  - `OperationFailure { success: false; errorClass: GitErrorClass; error: string; savedState?: { headHash; branchName; autoStashHash? }; suggestedActions: SuggestedAction[]; preflightIssues?: PreflightIssue[] }`
  - `PreflightIssue { kind: 'lock_held_fresh' | 'lock_stale' | 'merge_in_progress' | 'rebase_in_progress' | 'cherry_pick_in_progress' | 'revert_in_progress' | 'dirty_tree' | 'unknown_state'; description: string; autoFixable: boolean; gitProcesses?: GitProcessInfo[] }`
  - `PreflightReport { ok: boolean; issues: PreflightIssue[] }`
- Расширить `src/core/git/types/recovery.ts` — `RecoveryAction` варианты: `retry`, `apply_stash_only`, `drop_stash`, `kill_git_process`, `manual_continue`.
- Расширить `src/core/git/types/operations.ts` — `OperationResult` опциональные поля `errorClass`, `savedState`, `suggestedActions`, `preflightIssues` (backward-compat).
- Экспорт в `src/core/git/types/index.ts`.

### Блок 2. Классификатор ошибок

- `src/core/git/GitErrorClassifier.ts` — stateless `classify(stderr: string): ClassifiedError`. Паттерны:
  - `lock_held`: `/Unable to create '.+index\.lock': File exists/`
  - `conflict`: `/CONFLICT \(.+\):|Automatic merge failed/`
  - `dirty_tree`: `/Your local changes to the following files would be overwritten/`, `/would be clobbered by/`, `/changes would be overwritten/`
  - `merge_in_progress`: `/You have not concluded your merge|MERGE_HEAD exists/`
  - `rebase_in_progress`: `/rebase in progress|It seems that there is already a rebase/`
  - `network`: `/Could not resolve host|Connection timed out|fatal: unable to access|Connection refused|SSL_ERROR/`
  - `auth`: `/Authentication failed|Permission denied|could not read Username|fatal: Authentication/`
  - `non_fast_forward`: `/non-fast-forward|rejected.*non-fast-forward|Updates were rejected/`
  - `untracked_overwrite`: `/untracked working tree files would be overwritten/`
- Учесть локализованный stderr git (если LANG=ru_RU) — фолбэк на `unknown` если паттерны en не сработали.
- `tests/git/GitErrorClassifier.test.ts` — табличные тесты, ~30 фикстур из реального git output.

### Блок 3. Pre-flight проверки

- `src/core/safety/PreflightChecks.ts` — `check(repoPath: string, operation: string, opts?): Promise<PreflightReport>`:
  - `index.lock` — `fs.statSync` для возраста; ≥15s → авто-удаление (используем уже существующий код `RecoveryManager.checkLockFiles` как референс); <15s → `lock_held_fresh` issue с попыткой получить список git-процессов через `GitProcessDetector`.
  - State-файлы: `MERGE_HEAD`, `rebase-apply/`, `rebase-merge/`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`.
  - Конфликт операции и состояния: например `merge` при существующем `MERGE_HEAD` → блок.
  - Опционально dirty tree для `checkout`/`rebase`.
- `tests/safety/PreflightChecks.test.ts` — temp репо через `mkdtempSync` + `mkdirSync`/`writeFileSync`, возраст через `utimesSync`.

### Блок 4. Cross-platform детекция git-процессов

- `src/core/safety/GitProcessDetector.ts` — `findGitProcesses(repoPath?: string): Promise<GitProcessInfo[]>`:
  - Windows: `powershell -Command "Get-CimInstance Win32_Process -Filter \"Name='git.exe'\" | Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json"`
  - macOS/Linux: `ps -ax -o pid,command | grep -E '\bgit\b'`
  - Возвращает `{ pid: number; command: string; cwd?: string }[]`. Если детект не сработал — пустой массив (не блокирующая фича).
- Таймаут 2с на shell-вызов, чтобы не блокировать UI.
- `tests/safety/GitProcessDetector.test.ts` — мок `child_process.execFile` по платформам через override `process.platform`.

### Блок 5. SafetyNet рефактор

- Убрать слепой `reset --hard` + `stash pop` из catch-блока (`SafetyNet.ts:75-93`).
- `WrapOptions`:
  - `allowedErrorClasses?: GitErrorClass[]` (дефолт `['conflict']`)
  - `interactive: boolean` (default true)
  - `legacyAutoRollback?: boolean` (default false; временный флаг для совместимости старых тестов)
- При ошибке:
  - читаем `stderr` (для не-GitError исключений — пустая строка)
  - `classifier.classify(stderr)`
  - если `errorClass ∈ allowedErrorClasses` или `errorClass === 'conflict'` — возврат `{ success: false, errorClass, ... }` без rollback
  - если `transient` — возврат `OperationFailure` с `savedState` и `suggestedActions`, без rollback
  - если `unknown` и `legacyAutoRollback=true` — старое поведение
  - в остальных случаях — возврат `OperationFailure`, юзер сам разрулит через UI
- `tryRestoreAutoStash` → последовательность `stash apply <hash>` → если `exitCode === 0` → `stash drop <hash>`; если apply fail — стэш остаётся, `suggestedActions` включает `apply_stash_only` / `manual_continue`.
- Обновить `tests/safety/SafetyNet.test.ts` под новый контракт. Тест `'on operation error: auto-rollback resets to saved HEAD by default'` переписать на новый дефолт (нет rollback), плюс отдельный тест `'with legacyAutoRollback=true rolls back to saved HEAD'`.

### Блок 6. writeCommands интеграция

- В `safeWrite` (`writeCommands.ts:40-50`) перед `safety.wrapDestructive`:

  ```ts
  const report = await Preflight.check(repoPath, opName);
  if (!report.ok) {
    return { success: false, errorClass: 'preflight_blocked', preflightIssues: report.issues, suggestedActions: [...] };
  }
  ```

- Пробросить `allowedErrorClasses: ['conflict']` для `merge` / `rebase` / `cherry-pick` / `revert` / `pull`.
- `safeWrite` не throws — возвращает `OperationFailure`.
- Миграция `CommandHandler.restoreReflog` и `CommandHandler.startMerge` — они вызывают `safety.wrapDestructive` напрямую, надо обновить под новый контракт.

### Блок 7. RecoveryManager расширение

- Методы:
  - `applyStash(hash: string): Promise<OperationResult>` — `git stash apply <hash>`
  - `dropStash(hash: string): Promise<OperationResult>` — `git stash drop <hash>`
  - `killGitProcess(pid: number): Promise<void>` — `process.kill(pid, 'SIGTERM')` с проверкой что это реально git (через `GitProcessDetector`)
  - `retryOperation(journalEntryId: string): Promise<OperationResult>` — реиграть операцию по journal
- Расширить `executeRecovery` под новые `RecoveryAction`.
- Тесты в `tests/safety/RecoveryManager.test.ts`.

### Блок 8. IPC

- Расширить `operationEnd` event в `src/core/bridge/messages.ts`:

  ```ts
  | { type: 'operationEnd'; operation: string; success: boolean; error?: string; repoPath?: string | null;
      errorClass?: GitErrorClass;
      savedState?: { headHash: string; branchName: string; autoStashHash?: string };
      suggestedActions?: SuggestedAction[];
      preflightIssues?: PreflightIssue[];
    }
  ```

- Новое event `safetyIssue` (для случаев когда юзер должен решить ДО продолжения операции — pre-flight блок).
- Новая команда `safetyResolve { requestId; action: RecoveryAction }`.
- В `src/core/bridge/ipc/helpers.ts` — `op()` и `opWithPostMerge()` пробрасывают новые поля из результата в `operationEnd`.
- 5-мин таймаут в main на ожидание `safetyResolve`, чтобы операция не висла.

### Блок 9. Renderer — SafetyDialog

- `src/renderer/src/features/safety/SafetyDialog.tsx` — модал на базе `SgDialog`. Принимает `issue`/`failure` + `actions[]`, рендерит кнопки.
- `src/renderer/src/features/safety/SafetyDialog.module.css` — стили (списки state info, цветовая дифференциация danger/info actions).
- `src/renderer/src/features/safety/index.ts` — public exports.
- `src/renderer/src/hooks/useSafetyDialog.ts` — стейт-хук, очередь диалогов (FIFO), подписка через `useStateSubscription` deps.
- Mapping `SuggestedAction.kind` → `postCommand`:
  - `retry` → повторить последнюю команду (хранить в state)
  - `restore_stash` → `{ type: 'stashPopIndex', index: hash }` (по hash, не индексу)
  - `apply_stash_only` → `{ type: 'stashApply', index: hash }`
  - `drop_stash` → `{ type: 'stashDrop', index: hash }`
  - `kill_git_process` → новая команда `{ type: 'killGitProcess', pid }`
  - `remove_lock` → новая команда `{ type: 'removeIndexLock' }`
  - `rollback` → новая команда `{ type: 'rollbackOperation', journalEntryId }`
  - `abort_merge` → `{ type: 'abortMerge' }`
  - `continue_merge` → `{ type: 'completeMerge' }`
  - `cancel` / `ignore` → close dialog
- Подключить в `AppDialogs.tsx` через lazy-import.

### Блок 10. Renderer — toasts / runningOps

- `useRunningOps.ts` — расширить `OperationResult` новыми полями.
- `useStateSubscription.ts` — пробросить новые поля из `operationEnd` в `endOperation`.
- `useOperationToasts.ts`:
  - если есть `errorClass` — skip toast (SafetyDialog покажет)
  - для `errorClass === 'network'` — action-toast с кнопкой Retry (без модала, лёгкий путь)
- Расширить `SgToast` компонент опциональным action button.

### Блок 11. i18n

- `src/renderer/src/i18n/en.ts` и `ru.ts` — секция `safety`:
  - заголовки/описания по каждому `errorClass`
  - подписи `SuggestedAction` (retry, restore stash, kill process, apply stash, drop stash, rollback, abort merge, continue merge, ignore, cancel, manual continue, remove lock)
  - подписи `PreflightIssue` (lock fresh с PID, lock stale, merge in progress, rebase in progress, cherry-pick in progress, revert in progress, dirty tree, unknown state)

### Блок 12. OperationQueue улучшения

- В `enqueueWrite` опциональный pre-check `.git/index.lock` (через переданный repoPath). Не блокирует, но добавляет meta в OperationResult (на случай если safety это пропустила).
- Метрика длительности через `mainLogger.debug` — для performance анализа.
- Тест `tests/safety/OperationQueue.test.ts` — расширить кейсами на параллельные write в один cwd.

### Блок 13. Performance investigation (3-10s задержка после commit/merge)

- Profile `StateManager.refreshAll()` / `refreshStatusAndNotify()`:
  - добавить timing-логи в каждую фазу (`git log`, `git status`, `git for-each-ref`, graph layout calc, branch parse, refs parse)
  - найти "узкое горлышко"
- Кандидаты на оптимизацию:
  - распараллелить read-операции (status + log + branches могут идти одновременно)
  - кеш graph layout по HEAD hash (если HEAD не сменился — не пересчитывать)
  - инкрементальный refresh после commit (а не полный refreshAll)
- Документ в `docs/performance/refresh-investigation.md` с findings + минимальные патчи в скоупе.

### Блок 14. Логирование и observability

- `mainLogger.warn` для классифицированных ошибок: `safety: classified ${errorClass}, first line: ${firstLineOfStderr}`
- Поле `errorClass?: GitErrorClass` в `JournalEntry`
- Опциональный telemetry hook (выключен по умолчанию) — счётчик по классам в `userData/safety-stats.json`

### Блок 15. E2E + smoke

- `tests-e2e/safety-flow.spec.ts` сценарии:
  1. Создаём fake `.git/index.lock`, пробуем merge → SafetyDialog с выбором
  2. Merge с конфликтом — НЕ rollback, открывается merge editor (MergeBanner появляется)
  3. `git fetch` с заблокированным сетевым хостом — toast с Retry
  4. Orphaned stash после fail — диалог "восстановить"
- Тест на `OperationJournal` после fail — запись `errorClass` есть

### Блок 16. Документация

- `docs/safety-error-handling.md`:
  - архитектура (схема из этого документа)
  - таблица `errorClass` → `suggestedActions`
  - инструкция "как добавить новый класс ошибки" (паттерн в Classifier + локали + actions)
- Обновить главный `README.md` — раздел про error handling

## Очерёдность работы

1. Блоки 1, 2, 3 параллельно (типы, классификатор, preflight)
2. Блок 4 (GitProcessDetector) параллельно с 1-3
3. Блок 5 (SafetyNet рефактор) + обновление существующих тестов
4. Блок 6 (writeCommands)
5. Блок 7 (RecoveryManager)
6. Блок 8 (IPC)
7. Блоки 9, 10, 11 (UI)
8. Блок 12 (OperationQueue) 
9. Блок 13 (Performance) — параллельно с 7-8
10. Блок 14 (Logging)
11. Блок 15 (E2E)
12. Блок 16 (Документация)

## Точки риска

- **Контракт `safeWrite`** меняется (был throw → стал OperationFailure). Все вызовы пройти типизацией TS.
- **Backward compat** — флаг `legacyAutoRollback` временный, удалить после миграции тестов.
- **IPC `safetyResolve` async-ожидание** — 5-мин таймаут обязателен, иначе зависание.
- **Cross-platform детекция процессов** — fallback на "не показывать список" если детект упал (PowerShell может быть заблокирован policy).
- **Performance investigation** — может вскрыть рефакторинг refreshAll, что выходит за скоуп. Документируем — фиксим минимально, остальное в отдельной задаче.

## Дополнительный блок 17. Merge UX полировка

Не относится к safety напрямую, но логично сделать в этом же стриме — затрагивает тот же merge-flow.

### Проблема 1: MergeBanner не исчезает после резолва конфликтов

В `src/renderer/src/features/merge/MergeBanner.tsx` баннер показывается пока `mergeState.inProgress`. Когда все конфликты резолвнуты — баннер пишет "all resolved", но висит. Юзеру не нужна эта подтверждашка — он и так видит что красных файлов в списке нет.

**Фикс:**

- Скрыть баннер когда `mergeState.totalConflicts > 0 && mergeState.totalConflicts === mergeState.resolvedConflicts` (то есть конфликты были и все резолвнуты).
- Если конфликтов изначально не было (fast-forward отменён, ручной merge без конфликтов) — баннер тоже не нужен после первого рендера.
- Можно оставить компактный inline-индикатор в Toolbar или статусбаре: "merging X → Y" одной строкой, без жёлтого alarm-стиля.
- В `App.tsx` (`App.tsx:479`) условие `mergeState?.inProgress` заменить на функцию `shouldShowMergeBanner(mergeState)`.

### Проблема 2: При активном merge commit-сообщение надо предзаполнять

Сейчас `CommitBar` (`src/renderer/src/features/changes/CommitBar.tsx`) при merge показывает пустые поля subject/description. Юзер вынужден сам писать "Merge ..." или подбирать что-то. Fork (как и стандартный git) автоматически подставляет git-style сообщение `Merge branch 'X' into Y`.

**Фикс:**

- Передать `mergeState: MergeState | null` пропом в `CommitBar`.
- Если `mergeState?.inProgress && !subject && !description && !amend` (юзер ничего не вводил) — подставить:
  - subject = `` `Merge branch '${mergeState.sourceBranch}' into ${mergeState.targetBranch}` ``
  - description = пусто (опционально можно вставить `# Conflicts:\n#   <file1>\n#   <file2>` — но git сам это делает в редакторе, в плоском commit-input можно пропустить)
- Если юзер уже начал что-то печатать — НЕ перезаписывать его ввод (`useEffect` с гвардом на initial empty).
- После завершения merge (mergeCompleted event) поля очищаются через существующий `setSubject('')` / `setDescription('')`.

### Файлы

- `src/renderer/src/features/merge/MergeBanner.tsx` — добавить функцию-предикат / условие.
- `src/renderer/src/App.tsx` — условие рендера баннера обновить (около `App.tsx:479`).
- `src/renderer/src/features/changes/CommitBar.tsx` — новый prop `mergeState`, useEffect для предзаполнения.
- `src/renderer/src/features/layout/ChangesView.tsx` — пробросить `mergeState` в `CommitBar`.

### Тесты

- `tests/renderer/MergeBanner.test.tsx` (если есть тестинг renderer, или просто smoke): резолв всех конфликтов → баннер пропадает.
- `tests/renderer/CommitBar.test.tsx`: при `mergeState.inProgress=true` и пустых полях subject содержит `Merge branch 'X' into Y`; при ручном вводе — НЕ перезаписывается.

## Дополнительный блок 18. Auto-detect in-progress merge/conflict state

Логически часть safety, но конкретно — про UX того что **UI не видит активный конфликт** если репо открыт с уже UU файлами.

### Симптом

Юзер открывает репо, в котором уже есть UU файлы (например, прошлый merge упал и не был доведён, или cherry-pick конфликт без MERGE_HEAD). GitBor:

- НЕ показывает `MergeBanner` (потому что `mergeState.inProgress=false`)
- НЕ открывает merge editor для UU файлов
- При попытке Pull/Merge auto-stash падает с `error: could not write index` (`stash push` не работает с unmerged paths) — юзер видит непонятную ошибку.

В Fork то же состояние корректно показывается: заголовок "Merge conflict", список конфликтных файлов с маркировкой сторон, кнопка Merge/Merge in VS Code.

### Корень

1. `ConflictManager.isMergeInProgress()` проверяет только `.git/MERGE_HEAD`. Состояние "есть UU файлы" возникает шире:
   - `.git/MERGE_HEAD` (merge)
   - `.git/CHERRY_PICK_HEAD` (cherry-pick)
   - `.git/REVERT_HEAD` (revert)
   - `.git/rebase-apply/` или `.git/rebase-merge/` (rebase)
   - UU в индексе без всех вышеперечисленных (после ручного `reset --keep` или повреждённого state)
2. `mergeState` обновляется только через `mergeStateAfter` IPC-обёртку — после действий. При первом открытии репо никто его не запрашивает. `fullState` событие шлёт `conflicts: string[]` в slice, но не полный `MergeState`.
3. Auto-stash в `SafetyNet.wrapDestructive` не проверяет наличие UU перед `git stash push`.

### Фикс

#### Backend

- `ConflictManager.isMergeInProgress()` — переименовать в `isConflictResolutionInProgress()` (или добавить новый метод), проверять ВСЕ state-файлы выше + UU files. Возвращать `{ inProgress: boolean; kind: 'merge'|'cherry-pick'|'revert'|'rebase'|'unmerged-paths' }`.
- `ConflictManager.getMergeState()` — расширить полем `kind`; UI решит какой баннер показывать.
- `StateManager.refreshAll()` — после остальных рефрешей вызвать `getMergeState()` и слать `mergeState` событие. Тогда при первом открытии репо UI сразу получит актуальное состояние.
- Pre-flight (Блок 3) — добавить проверку UU files: `git diff --name-only --diff-filter=U`. Если есть UU → блок ЛЮБОЙ destructive операции (включая Pull/Merge/Rebase/Checkout). `PreflightIssue.kind = 'unmerged_paths'` с списком файлов в `description`.
- `SafetyNet` — перед `git stash push` проверять UU; если есть → не стэшить, вернуть `OperationFailure` с `errorClass='unmerged_paths'`.

#### Frontend

- `useStateSubscription` — обрабатывать `mergeState` всегда (уже обрабатывается), но дополнительно когда репо переключается → запрашивать `getMergeState` (postCommand) на швиче / при первом render.
- `App.tsx` — условие `mergeState?.inProgress` для MergeBanner оставить, но текст баннера менять по `mergeState.kind` ("merge in progress" / "cherry-pick in progress" / "unmerged paths" и т.п.).
- `ChangesView` — UU файлы маркировать **всегда**, даже если `mergeState.inProgress=false` (фолбэк-детект: если `status === 'U'`, показывать как конфликт).

### Файлы

- `src/core/commands/ConflictManager.ts` (`isMergeInProgress`, `getMergeState`)
- `src/core/state/StateManager.ts` + `RepoStateRefresher` (если он есть) — вызов getMergeState в refresh
- `src/core/safety/PreflightChecks.ts` — добавить UU detection
- `src/core/safety/SafetyNet.ts` — guard перед stash
- `src/renderer/src/features/merge/MergeBanner.tsx` — текст по `kind`
- `src/renderer/src/hooks/useStateSubscription.ts` — гарантировать запрос mergeState на switch repo
- `src/renderer/src/features/changes/...` — рендер UU всегда как конфликт

### Тесты

- `tests/commands/ConflictManager.test.ts` — кейсы: только UU без любых HEAD-файлов → `inProgress=true, kind='unmerged-paths'`; CHERRY_PICK_HEAD → `kind='cherry-pick'`; rebase-apply → `kind='rebase'`.
- `tests/safety/PreflightChecks.test.ts` — UU + попытка merge → блок с `unmerged_paths` issue.
- `tests/safety/SafetyNet.test.ts` — UU + wrapDestructive → не вызывает stash push, возвращает `OperationFailure`.

## Связанная отдельная задача (НЕ в этом скоупе)

**Stat-dirty в списке изменений** — AI-редакторы / format-on-save оставляют файлы в `M`-статусе с пустым diff. Fork это скрывает через `git update-index --refresh`. Фикс: добавить refresh в `StateManager.refreshAll()` после mutating ops. Закрывается отдельным PR ~30-50 строк, к safety-скоупу отношения не имеет.

## Команда запуска работы

```
Реализуй задачу из docs/tasks/safety-error-handling.md по блокам в указанной очерёдности.
Создавай todo-list через TodoWrite, обновляй статусы по ходу работы.
Не останавливайся до завершения всех 16 блоков.
Не задавай вопросы решай сам
Не запускай субмдели делай сам
```
