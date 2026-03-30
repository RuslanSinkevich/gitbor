# 17 — ConflictManager

## Слой: Application Layer + UI
## Файлы: `src/core/commands/ConflictManager.ts` + компоненты renderer
## Зависимости: types.ts, GitExecutor, GitParser, StateManager

---

## Назначение

Полный цикл разрешения конфликтов при merge/rebase/cherry-pick.
От выбора ветки до завершения merge. Референс: Fork.

Переиспользуется из SkyFork. Отличие: вместо делегирования merge editor в VS Code — собственный three-way merge на Monaco Editor.

## Цикл конфликта (6 шагов)

### Шаг 1: Диалог выбора merge

UI в Renderer:

```
┌──────────────────────────────────────────────────────┐
│  ⤵ Слияние веток                              ✕     │
│                                                      │
│  Слить:     ⑂ develop-int                      ▼    │
│  В ветку:   ⑂ Core/CRM-5197_TechPris...       ▼    │
│                                                      │
│  Опции:                                              │
│  ┌────────────────────────────────────────────────┐  │
│  │ ○ Обычное слияние (merge commit)              │  │
│  │ ● Слияние без коммита (--no-commit)           │  │
│  │ ○ Fast-forward если возможно (--ff)            │  │
│  │ ○ Squash (--squash)                           │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ⚠ Слияние может вызвать конфликты                   │
│                                                      │
│  ┌──────────┐  ┌──────────┐                          │
│  │ Слить    │  │ Отмена   │                          │
│  └──────────┘  └──────────┘                          │
└──────────────────────────────────────────────────────┘
```

Backend: предварительная проверка конфликтов:
```typescript
async predictConflicts(source: string, target: string): Promise<string[]> {
  // git merge-tree $(git merge-base source target) source target
}
```

### Шаг 2: Выполнение merge

```typescript
async merge(source: string, options: MergeOptions): Promise<MergeResult> {
  const args = ['merge'];
  if (options.noCommit) args.push('--no-commit');
  if (options.squash) args.push('--squash');
  if (options.ffOnly) args.push('--ff-only');
  args.push(source);

  const result = await this.git.exec(args);

  if (result.exitCode === 0) {
    return { success: true, conflicts: [] };
  }

  const conflicts = await this.getConflictFiles();
  return { success: false, conflicts };
}
```

Merge оборачивается в SafetyNet (auto-stash + WAL журнал).

### Шаг 3: Показ конфликтов (дерево файлов)

UI — заменяет Detail Panel:

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠ СЛИЯНИЕ develop-int → Core/CRM-5197   9 конфликтов    [Abort]│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Unstaged (конфликтные)                              [Stage All] │
│  ▼ backend/                                                      │
│    ▼ crm-base-common/                                            │
│      ⚠ GlobalSettings.cs                                        │
│    ▼ crm-server/                                                 │
│      ▼ wwwroot/                                                  │
│        ⚠ chunk-vendors.js                                       │
│        ⚠ main.js                                                │
│  ▼ client/                                                       │
│    ▼ src/                                                        │
│      ▼ controller/                                               │
│        ▼ module/techpris/                                        │
│          ▼ incoming/                                             │
│            ⚠ attributesTab.js                                   │
│          ▼ outgoing/                                             │
│            ⚠ outgoing.js                                        │
│                                                                  │
│  Staged (разрешённые)                                            │
│  ▼ backend/                                                      │
│    ✓ crm-base-common/OtherFile.cs                               │
│                                                                  │
│  ──────────────────────────────────────────────────────────────  │
│  Прогресс: 0 из 9 конфликтов разрешено                          │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                            │
│                                                                  │
│  [Завершить merge]  (неактивна пока есть неразрешённые)          │
└──────────────────────────────────────────────────────────────────┘
```

### Шаг 4: Клик по конфликтному файлу

Действия:

```
┌──────────────────────────────────────────────────┐
│  ⚠ Конфликт слияния                              │
│  backend/crm-base-common/GlobalSettings.cs       │
│                                                   │
│  ┌───────────────────────┐                        │
│  │ Открыть в merge       │  → Monaco three-way   │
│  │ editor                │    merge               │
│  ├───────────────────────┤                        │
│  │ Принять левую сторону │  → git checkout --ours │
│  ├───────────────────────┤                        │
│  │ Принять правую сторону│  → git checkout        │
│  │                       │    --theirs            │
│  ├───────────────────────┤                        │
│  │ Открыть diff          │  → Monaco diff         │
│  └───────────────────────┘                        │
└──────────────────────────────────────────────────┘
```

В SkyFork merge editor делегировался в VS Code.
В SkyFork — собственный three-way merge на Monaco Editor в Detail Panel.

### Шаг 5: После разрешения каждого файла

FileWatcher обнаруживает изменение → refreshStatus() → обновляется список:
- Файл больше не в Unstaged/Unmerged → перемещается в Staged
- Прогресс обновляется: "3 из 9 разрешено"
- Когда все разрешены → кнопка "Завершить merge" становится активной

### Шаг 6: Завершение merge

```typescript
async completeMerge(message?: string): Promise<OperationResult> {
  const conflicts = await this.getConflictFiles();
  if (conflicts.length > 0) {
    return { success: false, error: 'Не все конфликты разрешены' };
  }

  await this.git.exec(['add', '--all']);

  if (message) {
    await this.git.exec(['commit', '-m', message]);
  } else {
    await this.git.exec(['commit', '--no-edit']);
  }

  return { success: true, rollbackAvailable: true };
}
```

### Abort merge

```typescript
async abortMerge(): Promise<void> {
  await this.git.exec(['merge', '--abort']);
}
```

## Backend: ConflictManager

```typescript
class ConflictManager {
  constructor(
    private git: GitExecutor,
    private state: StateManager
  ) {}

  async predictConflicts(source: string, target: string): Promise<string[]>
  async getConflictFiles(): Promise<ConflictFile[]>
  async getMergeFileTree(): Promise<MergeFileTree>
  async resolveWithOurs(file: string): Promise<void>
  async resolveWithTheirs(file: string): Promise<void>
  async stageResolved(file: string): Promise<void>
  async completeMerge(message?: string): Promise<OperationResult>
  async abortMerge(): Promise<void>
  async isMergeInProgress(): Promise<boolean>
}
```

## Git-команды

| Действие | Команда |
|----------|---------|
| Предсказание конфликтов | `git merge-tree $(git merge-base A B) A B` |
| Merge без коммита | `git merge --no-commit branch` |
| Список конфликтных файлов | `git diff --name-only --diff-filter=U` |
| Статус файлов при merge | `git status --porcelain` |
| Принять нашу версию | `git checkout --ours -- file && git add file` |
| Принять их версию | `git checkout --theirs -- file && git add file` |
| Stage файл | `git add file` |
| Завершить merge | `git commit --no-edit` |
| Отменить merge | `git merge --abort` |
| Проверить merge в процессе | `test -f .git/MERGE_HEAD` |

## UI компоненты

```
renderer/src/components/
  merge/
    MergeDialog.tsx          — Диалог выбора ветки и опций (шаг 1)
    ConflictPanel.tsx        — Панель конфликтов (заменяет CommitDetails при merge)
    ConflictFileTree.tsx     — Дерево файлов (Unstaged/Staged с вложенностью)
    ConflictActions.tsx      — Кнопки действий для файла
    MergeProgress.tsx        — Прогресс-бар разрешения
```

## Интеграция с Safety Layer

Весь merge оборачивается в SafetyNet:
- Auto-stash перед merge
- WAL журнал: begin('merge') → ... → complete('merge')
- Abort → SafetyNet.rollback + восстановление auto-stash
- Обрыв питания → RecoveryManager обнаружит MERGE_HEAD → предложит abort/continue

## Edge Cases

- Merge без конфликтов → сразу успех, без показа конфликт-панели
- Fast-forward merge → нет merge commit, просто перемещение HEAD
- 100+ конфликтных файлов → виртуальный скроллинг в дереве
- Бинарные файлы в конфликте → только ours/theirs
- Конфликт в удалённом файле (deleted by us/theirs) → специальный UI
- Пользователь разрешил конфликт внешним инструментом → FileWatcher подхватит
