# Задача: stat-dirty файлы (пустышки в Unstaged)

> Стартовый промпт для нового агентского таба. Скопируй в новый чат.

---

## Проблема

В списке Unstaged периодически появляются файлы со статусом `M`, у которых **diff пустой**. Источник — внешние инструменты (Cursor, format-on-save, lint-fix, IDE-метаданные) трогают `mtime` файла без реального изменения контента.

`git status` помечает файл dirty по сравнению `stat(file)` ↔ stat в индексе, не сверяя контент. `git diff` показывает пусто, потому что хеши совпадают.

**Текущее поведение GitBor:**
- файл в списке Unstaged как `M`;
- клик 1 раз → DiffPanel **рендерит его как «новый файл»** (полное содержимое как добавленное), потому что generic-fallback на пустой diff;
- двойной клик → исчезает (видимо после какого-то рефреша или re-stat'а).

**Fork-овое поведение:**
- файл показан, но визуально «пустышкой» (тусклый, иконка отличается, нет цвета);
- клик → diff показывает пустоту с подсказкой «No changes»;
- при клике или на следующем фоновом рефреше — исчезает.

## Корень

В `git update-index --refresh` лежит решение: команда сверяет реальные хеши и убирает stat-dirty флаги. Fork это делает после каждой write-операции и периодически. У нас этого вызова нет вообще — упоминается в `docs/performance/refresh-investigation.md` как «отдельная задача».

Дополнительно баг рендера: при пустом diff DiffPanel не имеет ветки «empty diff» и фолбэчит на «новый файл» (или показывает контент как добавленный).

## Цель

Два уровня решения:

1. **Корень.** Вызывать `git update-index --refresh` в правильных местах → файлы вообще не появляются как stat-dirty.
2. **Fallback.** Если файл всё-таки попал в список и diff пустой → показывать как «пустышку» (как Fork), не как новый файл. Клик → toast/банер «No actual changes, refreshing...» + триггерим `update-index --refresh` → файл исчезает.

## Что сделать

### 1. `git update-index --refresh` после write-операций

В `src/core/commands/writeCommands.ts` (или в `RepoStateRefresher.refreshAll`) после успешной write-команды и **перед** `git status --porcelain`:

```ts
await this.git.exec(['update-index', '--refresh'], { ignoreExitCode: true });
```

Важно: `update-index --refresh` возвращает **non-zero exit-code** если есть реальные модификации (это нормальное поведение, не ошибка). `ignoreExitCode: true` обязателен, иначе wrapDestructive это посчитает фейлом.

Места вызова:
- после `commit`, `merge`, `cherry-pick`, `revert`, `rebase`, `reset`, `checkout`, `pull` — то есть везде где `RepoStateRefresher.refreshAll` следует за git-командой;
- **достаточно вызывать раз в `refreshAll` перед `git status`**, не в каждой команде отдельно.

### 2. Refresh по триггеру от FileWatcher

В `FileWatcher` сейчас при изменении файла в worktree триггерится `refreshAll`. До `git status` — вставить тот же `update-index --refresh`. Это закроет случай «Cursor сохранил файл, mtime изменился, контент тот же».

Здесь нужен debounce — если FileWatcher частит, `update-index --refresh` тоже не должен молотить (он лёгкий, но всё же I/O). Достаточно вызывать его внутри `refreshAll`, который уже debounced.

### 3. Распознавание stat-dirty в `getFileDiff`

В обработчике команды `getFileDiff` (`src/core/commands/readCommands.ts` или соседний):

- если для `hash='WORKING'` запросили diff файла и `git diff <file>` пустой → не возвращать пустой результат как «нечего показать» (что фолбэчит на «новый файл» в UI), а возвращать **специальный маркер**: `{ files: [], statDirty: true, file: '<path>' }`.
- расширить `FileDiff` тип полем `statDirty?: boolean` или использовать тег.

### 4. Рендер в DiffPanel

В `src/renderer/src/features/diff/DiffPanel.tsx` или `DiffView.tsx`:

- если `statDirty: true` → показать **пустой стейт** с текстом:
  - заголовок «No actual changes»;
  - подсказка «File metadata changed but content is identical. This usually happens after format-on-save or external tools touched the file.»;
  - кнопка `Refresh index` → шлёт команду `refreshStatIndex` (новый IPC), которая зовёт `git update-index --refresh` и обновляет state.
- НЕ рендерить контент как «новый файл».

### 5. Визуальный маркер в списке Unstaged

В `LocalChanges.tsx` для stat-dirty файлов:

- если у `FileStatus` есть флаг `statDirty: true` (приходит из state после диагностики на backend) → строка тусклая (opacity 0.6), иконка с `…` или вопросом, tooltip «No actual changes (stat-dirty)».
- клик по такому файлу → попытка `refreshStatIndex` + открыть diff (где будет пустой стейт из п.4).

**Backend-детекция статуса `statDirty`:** в момент сбора status для UI делать отдельный проход по файлам со статусом `M` — `git diff --numstat <file>`. Если pair `(added, deleted) == (0, 0)` → пометить statDirty.

Это лишний git-вызов на каждый M-файл, поэтому **только если** в статусе ≤20 M-файлов (типичный кейс). При больше — пропускать детекцию, надеяться на `update-index --refresh` из п.1.

### 6. Не паниковать на статусе

В preflight (`PreflightChecks.checkDirtyTree`) — после `update-index --refresh` тот же `git status --porcelain` должен возвращать чистое состояние. Если stat-dirty файлы фильтрнулись — preflight тоже их не увидит, dirty_tree issue не появится. Это бонус: меньше ложных блокировок safety-операций из-за «грязного дерева», которое на самом деле чистое.

## Файлы

- `src/core/state/RepoStateRefresher.ts` — вставить `update-index --refresh` перед `git status` (1 место — закрывает всё).
- `src/core/commands/readCommands.ts` / `getFileDiff` — отдавать `statDirty: true` при пустом diff working tree.
- `src/core/git/types/diff.ts` (или где определён `FileDiff`) — добавить `statDirty?: boolean`.
- `src/core/git/types/state.ts` / `FileStatus` — добавить `statDirty?: boolean`.
- `src/core/bridge/messages.ts` — новая команда `refreshStatIndex`.
- `src/core/bridge/ipc/handlersGitOps.ts` (или соседний) — handler `refreshStatIndex` → `update-index --refresh` + рефреш state.
- `src/renderer/src/features/diff/DiffPanel.tsx` — пустой стейт для `statDirty`.
- `src/renderer/src/features/changes/LocalChanges.tsx` — визуальный маркер.
- `src/renderer/src/features/changes/FileTree.tsx` — opacity + иконка для statDirty.
- `src/renderer/src/i18n/{en,ru}.ts` — новые ключи.

## Не делать

- Не вызывать `git update-index --refresh` синхронно на каждый mouse-event или scroll. Только в рамках `refreshAll`.
- Не делать `--really-refresh` (это дополнительно проверяет содержимое = дорого на больших репо). Обычный `--refresh` достаточен.
- Не пытаться предсказать «это format-on-save» по таймингу/имени файла. Бессмысленно.

## Метрики приёмки

- После `git commit` файлы, тронутые Cursor'ом перед коммитом, не появляются в Unstaged (`update-index --refresh` сработал в `refreshAll`);
- Если stat-dirty всё же появился (например внешний `touch file.ts` уже после refresh'а) → строка в списке тусклая, при открытии diff показывает пустой стейт «No actual changes» с кнопкой «Refresh index»;
- После клика «Refresh index» файл исчезает из списка;
- Юзер больше **не видит** stat-dirty файлы как «новые добавленные» в DiffPanel — поведение корректное.

## Связано

- `docs/tasks/safety-relaxation.md` — preflight перестанет ловить ложный `dirty_tree` для stat-dirty файлов;
- `docs/performance/refresh-investigation.md` — пункт 3 «Кандидаты на отдельную задачу» закрывается этой задачей.

## Запуск

Реализуй задачу из `docs/tasks/stat-dirty-files.md`. Начни с `update-index --refresh` в `refreshAll` (это закроет 90% кейсов), потом UI-fallback для оставшегося 10%. Без лишних вопросов.
