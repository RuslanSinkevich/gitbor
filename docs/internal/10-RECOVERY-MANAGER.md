# 10 — RecoveryManager

## Слой: Safety Layer
## Файл: `src/core/safety/RecoveryManager.ts`
## Зависимости: types.ts, GitExecutor, OperationJournal, SafetyNet

---

## Назначение

Первый модуль который работает при запуске приложения.
Проверяет: не было ли аварийного завершения? Не осталось ли мусора от прерванных операций?
Если обнаружил проблему — показывает диалог пользователю с вариантами действий.

Адаптирован из SkyFork: VS Code API заменены на Electron API.

## Интерфейс

```typescript
class RecoveryManager {
  constructor(
    private git: GitExecutor,
    private journal: OperationJournal,
    private safetyNet: SafetyNet
  ) {}

  async checkOnStartup(): Promise<RecoveryReport>

  async executeRecovery(action: RecoveryAction): Promise<void>
}
```

## RecoveryReport

```typescript
interface RecoveryReport {
  hasIssues: boolean
  issues: RecoveryIssue[]
}

interface RecoveryIssue {
  type: 'interrupted_operation' | 'lock_file' | 'unfinished_merge' |
        'unfinished_rebase' | 'orphaned_auto_stash'
  description: string
  journalEntry?: JournalEntry
  suggestedAction: RecoveryAction
}

type RecoveryAction =
  | { type: 'rollback'; journalEntryId: string }
  | { type: 'continue_merge' }
  | { type: 'abort_merge' }
  | { type: 'continue_rebase' }
  | { type: 'abort_rebase' }
  | { type: 'remove_lock' }
  | { type: 'restore_stash'; stashHash: string }
  | { type: 'ignore' }
```

## Проверки при запуске

### 0. Наличие Git (САМАЯ ПЕРВАЯ ПРОВЕРКА)

До всех остальных проверок — убедиться что git доступен.

```typescript
async checkGitAvailable(): Promise<{ available: boolean; version?: string; path?: string }> {
  try {
    const result = await this.git.exec(['--version']);
    return { available: true, version: result.stdout.trim(), path: this.git.getGitPath() };
  } catch {
    return { available: false };
  }
}
```

Если git недоступен — показать диалог через Electron:

```typescript
import { dialog, shell } from 'electron';

if (!gitCheck.available) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'Git не найден',
    message: 'SkyFork: Git не обнаружен. Для работы приложения необходим Git.',
    buttons: ['Скачать Git', 'Указать путь к Git', 'Закрыть'],
    defaultId: 0,
  });

  if (result.response === 0) {
    shell.openExternal('https://git-scm.com/downloads');
  } else if (result.response === 1) {
    // Открыть диалог выбора файла для указания пути к git
    const fileResult = await dialog.showOpenDialog(mainWindow, {
      title: 'Укажите путь к git',
      filters: [{ name: 'Git', extensions: ['exe', ''] }],
    });
    if (fileResult.filePaths.length > 0) {
      // Сохранить путь в electron-store
    }
  }

  return; // Приложение не запускается без git
}
```

### 1. Журнал операций (OperationJournal)

```typescript
const incomplete = await journal.getIncomplete();
// Записи со status === 'started'
// Значит: операция начата, но не завершена — был обрыв
```

Действие: предложить откат к savedState из записи.

### 2. Git lock файлы

```typescript
const lockExists = fs.existsSync(path.join(gitDir, 'index.lock'));
```

Если `.git/index.lock` существует — от крашнувшего git-процесса.
Действие: предложить удалить (после проверки что git-процессов нет).

### 3. Незавершённый merge

```typescript
const mergeHead = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
```

Действие: предложить `git merge --abort` или продолжить.

### 4. Незавершённый rebase

```typescript
const rebaseApply = fs.existsSync(path.join(gitDir, 'rebase-apply'));
const rebaseMerge = fs.existsSync(path.join(gitDir, 'rebase-merge'));
```

Действие: предложить `git rebase --abort` или продолжить.

### 5. Осиротевший auto-stash

```typescript
const stashList = await git.exec(['stash', 'list']);
// Найти stash с меткой "[SkyFork auto-stash]"
// Если есть и в журнале нет соответствующей незавершённой записи
// → stash был создан, но операция не восстановила его
```

Действие: предложить восстановить (`git stash pop`) или удалить.

## Диалог пользователю (Electron)

В SkyFork — `vscode.window.showWarningMessage`.
В SkyFork — `dialog.showMessageBox` или кастомный UI в Renderer:

```typescript
import { dialog } from 'electron';

const result = await dialog.showMessageBox(mainWindow, {
  type: 'warning',
  title: 'Прерванная операция',
  message: 'Обнаружена прерванная операция "checkout develop". Репозиторий может быть в промежуточном состоянии.',
  buttons: ['Откатить к сохранённому состоянию', 'Игнорировать'],
  defaultId: 0,
});

if (result.response === 0) {
  await this.executeRecovery({ type: 'rollback', journalEntryId: entry.id });
}
```

Для merge/rebase — три кнопки:
```typescript
const result = await dialog.showMessageBox(mainWindow, {
  type: 'warning',
  title: 'Незавершённый merge',
  message: 'Обнаружен незавершённый merge. Что сделать?',
  buttons: ['Завершить merge', 'Отменить merge', 'Игнорировать'],
  defaultId: 0,
});
```

## Порядок проверок

0. **Git доступен** (без git — стоп)
1. Lock файлы (быстро, критично)
2. Журнал операций (наш WAL)
3. Git состояние (MERGE_HEAD, rebase)
4. Осиротевший auto-stash

## Edge Cases

- Несколько незавершённых записей в журнале → обработать каждую
- Lock файл + незавершённый merge → сначала lock, потом merge
- Журнал повреждён (маловероятно с AtomicWrite) → создать новый, проверить только git-состояние
- Репозиторий удалён/перемещён → пропустить, не падать
