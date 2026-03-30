# 12 — FileWatcher

## Слой: Application Layer
## Файл: `src/core/state/FileWatcher.ts`
## Зависимости: StateManager

---

## Назначение

Следит за изменениями в `.git/` директории. Когда что-то изменилось — вызывает соответствующий refresh в StateManager. Обеспечивает автообновление UI без ручного нажатия "Обновить".

Адаптирован из SkyFork: `vscode.workspace.createFileSystemWatcher` заменён на `chokidar`.

## Интерфейс

```typescript
class FileWatcher {
  constructor(private stateManager: StateManager) {}

  watch(repoPath: string): void

  unwatch(): void

  switchRepo(repoPath: string): void

  dispose(): void
}
```

## Что отслеживаем

| Файл/директория | Событие | Действие |
|----------------|---------|----------|
| `.git/HEAD` | Изменён | refreshBranches() — переключена ветка |
| `.git/refs/heads/` | Любое | refreshBranches() + refreshGraph() — новая ветка/коммит |
| `.git/refs/remotes/` | Любое | refreshBranches() — fetch обновил remote |
| `.git/refs/tags/` | Любое | refreshTags() |
| `.git/refs/stash` | Любое | refreshStashes() |
| `.git/index` | Изменён | refreshStatus() — staging изменился |
| `.git/MERGE_HEAD` | Создан/удалён | refreshStatus() — merge начат/завершён |

## Дебаунс

Git может менять несколько файлов за одну операцию (commit меняет HEAD, refs, index одновременно). Без дебаунса — 3 рефреша вместо одного.

Дебаунс 300ms: собираем все изменения за 300ms, потом вызываем один refreshAll().

```typescript
private debounceTimer: NodeJS.Timeout | null = null;

private scheduleRefresh(): void {
  if (this.debounceTimer) clearTimeout(this.debounceTimer);
  this.debounceTimer = setTimeout(() => {
    this.stateManager.refreshAll();
  }, 300);
}
```

## Реализация через chokidar (Electron)

В SkyFork — `vscode.workspace.createFileSystemWatcher`.
В SkyFork — `chokidar` (Node.js, доступен в Main Process):

```typescript
import chokidar from 'chokidar';

class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;

  watch(repoPath: string): void {
    const gitDir = path.join(repoPath, '.git');

    this.watcher = chokidar.watch(gitDir, {
      ignored: [
        '**/objects/**',     // объекты git — слишком частые изменения, не нужны
        '**/logs/**',        // reflog — не влияет на UI
        '**/*.lock',         // lock-файлы — временные
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('change', () => this.scheduleRefresh());
    this.watcher.on('add', () => this.scheduleRefresh());
    this.watcher.on('unlink', () => this.scheduleRefresh());
  }

  unwatch(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  dispose(): void {
    this.unwatch();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}
```

## Почему chokidar, а не fs.watch

- `fs.watch` нестабилен на разных ОС (двойные события, отсутствие событий)
- chokidar — де-факто стандарт для Node.js file watching
- Поддержка glob-паттернов для ignored
- `awaitWriteFinish` — ждёт завершения записи перед событием

## Edge Cases

- `.git` — симлинк (git worktree) → chokidar следует за симлинками по умолчанию
- Очень частые изменения (rebase 100 коммитов) → дебаунс защищает от шторма
- Watcher не работает (сетевая FS) → fallback на ручной refresh (кнопка в UI)
