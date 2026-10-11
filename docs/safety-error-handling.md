# Безопасность и обработка ошибок

> English version: [docs/en/safety-error-handling.md](en/safety-error-handling.md)

GitBor различает классы git-ошибок и НЕ делает auto-rollback на любой
fail. Юзер видит модальный SafetyDialog с предложенными действиями
(retry / abort merge / restore stash / kill git-process / удалить
index.lock / откатить).

## Архитектура

```
UI (Renderer)          IPC          WriteCommand       Preflight    SafetyNet         Classifier      Git
   |                    |                |                  |             |                 |           |
   | merge(branch) -->  |                |                  |             |                 |           |
   |                    | merge --->     |                  |             |                 |           |
   |                    |                |   check(op) ---> |             |                 |           |
   |                    |                |   blocked? -> ok=false → suggestedActions          |           |
   |                    |                | wrapDestructive(allowedErrorClasses=['conflict'])----->     |
   |                    |                |                  |             | UU check ───────────────>  |
   |                    |                |                  |             | stash push (если есть локалки)
   |                    |                |                  |             | merge ----------------->   |
   |                    |                |                  |             | exitCode != 0?             |
   |                    |                |                  |             | classify(stderr)->class    |
   |                    |                |                  |             | conflict → success:false, conflicts:[] (НЕТ rollback)
   |                    |                |                  |             | transient/unknown → OperationFailure + suggestedActions (НЕТ rollback)
   |                    |                | <-----------------------       |                 |           |
   |                    | operationEnd { errorClass, savedState, suggestedActions } <----    |           |
   | useOperationToasts видит errorClass → НЕ показывает toast                                          |
   | useSafetyDialog открывает SafetyDialog с кнопками действий                                         |
   | юзер выбирает → postCommand → выполнение (stashApply / resetTo / retry / abortMerge / ...)         |
```

**Инвариант:** rollback и stash-pop делает только пользователь через UI.
Бэкенд готовит варианты, не принимает решения.

## Таблица errorClass → suggestedActions

| `GitErrorClass` | UI title | Default actions |
|---|---|---|
| `lock_held` | Another git process is running | `remove_lock`, `retry`, `cancel` |
| `conflict` | Merge conflicts | `continue_merge`, `abort_merge`, `cancel` |
| `dirty_tree` | Local changes would be overwritten | `rollback`, `cancel` |
| `merge_in_progress` | Merge in progress | `continue_merge`, `abort_merge`, `cancel` |
| `rebase_in_progress` | Rebase in progress | `abort_rebase`, `manual_continue`, `cancel` |
| `cherry_pick_in_progress` | Cherry-pick in progress | `continue_cherry_pick`, `abort_merge`, `cancel` |
| `revert_in_progress` | Revert in progress | `continue_merge`, `abort_merge`, `cancel` |
| `unmerged_paths` | Unresolved conflicts | `continue_merge`, `abort_merge`, `cancel` |
| `network` | Network error | `retry`, `cancel` |
| `auth` | Authentication failed | `retry`, `cancel` |
| `non_fast_forward` | Remote rejected push | `rollback`, `cancel` |
| `untracked_overwrite` | Untracked files would be overwritten | `rollback`, `cancel` |
| `preflight_blocked` | Operation blocked | (по issues — см. `runPreflight` в writeCommands) |
| `unknown` | Operation failed | `rollback`, `cancel` |

Если в `SavedState.autoStashHash` есть стэш — к списку добавляются
`apply_stash_only` и `drop_stash` (юзер может сразу его подтянуть).

Для конфликта cherry-pick «Продолжить» — это `continue_cherry_pick`
(`git cherry-pick --continue`), а «Отменить слияние» (`abort_merge`) сам
определяет активную операцию: при `CHERRY_PICK_HEAD` / `REVERT_HEAD` выполняется
`cherry-pick --abort` / `revert --abort`, иначе `merge --abort`.

## Auto-stash и откат

- **Создан ли стэш.** Перед операцией SafetyNet делает `git stash push -u`.
  Если откладывать нечего (например, изменения только внутри подмодуля), git
  выходит с кодом 0 и стэш не создаёт. Поэтому факт создания проверяется по
  сдвигу `refs/stash` (`readStashTip` до и после), а не по коду выхода —
  иначе `stash@{0}` оказывался бы чужим пользовательским стэшем и после
  операции применялся и удалялся. Тем же способом ручной «Отложить» отличает
  успех от «нечего откладывать».
- **Порядок отката.** `rollback` сначала делает `checkout -f` на сохранённую
  ветку (или `--detach` на сохранённый коммит), затем `reset --hard`. В
  обратном порядке `reset` сдвинул бы ветку, на которую операция успела
  переключиться. Коды выхода проверяются: при сбое показывается ошибка, а не
  ложный успех. Auto-stash после отката применяется и удаляется.

## Действия восстановления

`RecoveryManager.executeRecovery` выполняет выбранное в диалоге действие и
проверяет код выхода каждой git-команды — при сбое ошибка уходит в UI.

- `remove_lock` — удаляет `index.lock`, но не моложе 2 секунд (git, возможно,
  ещё работает): тогда показывается сообщение «попробуйте через несколько
  секунд».
- `restore_stash` (осиротевший auto-stash при старте) — применяет и удаляет
  стэш, чтобы диалог не появлялся при каждом запуске.

## Git-dir и локаль

- Все state-файлы (`MERGE_HEAD`, `rebase-merge/`, `index.lock`, журнал,
  хуки) ищутся через `resolveGitDir()` / `resolveCommonGitDir()`
  (`src/core/git/gitDir.ts`). В связанных worktree и подмодулях `.git` — файл
  `gitdir: …`, и прежний `join(repo, '.git')` их не находил.
- `GitErrorClassifier` распознаёт классы по английскому stderr, поэтому
  `GitExecutor` всегда запускает git с `LC_MESSAGES=C`. Без этого при русской
  локали конфликт merge считался «неизвестной ошибкой».

## Pre-flight checks

`PreflightChecks.check(repoPath, operation, opts?)` проверяет ПЕРЕД
стартом destructive операции:

1. **`.git/index.lock`** — `<15s` → блок (юзер решает: kill / remove);
   `≥15s` → молча удаляется.
2. **State-файлы**: `MERGE_HEAD`, `rebase-apply/`, `rebase-merge/`,
   `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`.
3. **UU files** (`git diff --name-only --diff-filter=U`) — блок ЛЮБОЙ
   destructive операции, кроме самих merge-резолверов
   (`completeMerge`, `abortMerge`, `resolveOurs`, `resolveTheirs`).
4. **Dirty tree** — только для `checkout` и `rebase` (остальные через
   SafetyNet auto-stash).

При блоке возвращается `PreflightReport { ok: false, issues: [...] }`,
который writeCommands оборачивает в `OperationFailure` с
`errorClass='preflight_blocked'` и suggestedActions по типу issue.

## Cross-platform детекция git-процессов

`GitProcessDetector.findGitProcesses(repoPath?)`:

- **Windows**: `powershell Get-CimInstance Win32_Process -Filter "Name='git.exe'"`,
  парсит JSON-output.
- **macOS / Linux**: `ps -ax -o pid,command`, фильтр по `\bgit\b`.
- Таймаут 2s; при failure (PowerShell policy, ps отсутствует) возвращает
  пустой массив (best-effort, не блокирующая фича).

Используется в SafetyDialog для информативного вывода при `lock_held`:
показывает pid + command-line процессов, держащих lock.

## Как добавить новый класс ошибки

1. **`src/core/git/types/errors.ts`** — расширь `GitErrorClass` новым
   значением.
2. **`src/core/git/GitErrorClassifier.ts`** — добавь паттерн в
   `PATTERNS[]` (порядок важен: специфичные сверху, общие снизу).
3. **`src/core/safety/SafetyNet.ts`** в `buildActions(errorClass, ...)`
   добавь case для нового класса с подходящими `SuggestedAction[]`.
4. **`src/renderer/src/i18n/en.ts` + `ru.ts`** в секции `safety`:
   - `titles.<class>` — заголовок диалога
   - `descriptions.<class>` — описание ниже заголовка
5. **`src/renderer/src/hooks/useSafetyDialog.ts`** — если класс должен
   показывать SafetyDialog (а не toast), добавь в
   `SUPPRESS_TOAST_CLASSES`.
6. **Тест**: добавь фикстуру с реальным stderr в
   `tests/git/GitErrorClassifier.test.ts`.

## OperationJournal

После рефакторинга `OperationJournal.fail(id, error, errorClass?)`
принимает опциональный `errorClass: GitErrorClass`. SafetyNet всегда
его передаёт — журнал хранит класс для последующего анализа (recovery
после перезапуска / телеметрия).

`safety-stats.json` в `userData/` — опциональный счётчик ошибок по
классам. Включён если `GITBOR_SAFETY_STATS=1` или если файл уже
существует. Никаких сетевых отправок.

## Performance: deferHeavy refresh

Write-операции, добавляющие 1 коммит сверху (`commit`, `merge`,
`cherry-pick`, `revert`, `pull`, `rebase`, `reset`, `restoreReflog`),
получают `deferHeavy: true` в `refreshAll`:

- `refreshFast` + `refreshGraph(500)` дожидаются (юзер видит первый
  фрейм с актуальным state ~250ms).
- `refreshGraph(50000)` — fire-and-forget, графа догрузится фоном.

На монорепо (vscode / chromium) экономит 3-8 секунд между `git commit`
и отзывчивым UI.
