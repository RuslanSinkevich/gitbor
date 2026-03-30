# 11 — StateManager

## Слой: Application Layer
## Файл: `src/core/state/StateManager.ts`
## Зависимости: types.ts, GitExecutor, GitParser, GraphLayout

---

## Назначение

Единый источник правды о состоянии репозитория.
Весь UI (React в Renderer Process) получает данные только от StateManager.
StateManager получает данные от GitExecutor + GitParser.

Полностью переиспользуется из SkyFork без изменений.

## Интерфейс

```typescript
class StateManager {
  constructor(
    private git: GitExecutor,
    private parser: typeof GitParser,
    private graphLayout: typeof GraphLayout
  ) {}

  getState(): AppState

  async refreshAll(): Promise<void>

  async refreshBranches(): Promise<void>
  async refreshStatus(): Promise<void>
  async refreshGraph(maxCount?: number): Promise<void>
  async refreshTags(): Promise<void>
  async refreshStashes(): Promise<void>

  async switchRepo(repoPath: string): Promise<void>

  subscribe(listener: (state: AppState) => void): () => void
}
```

## Кеширование

Граф коммитов — самая тяжёлая операция. Кешируем:

```typescript
private cachedHeadHash: string | null = null;

async refreshGraph(maxCount = 500): Promise<void> {
  const headHash = (await this.git.exec(['rev-parse', 'HEAD'])).stdout.trim();

  if (headHash === this.cachedHeadHash) return;

  this.cachedHeadHash = headHash;
  // ... перечитать граф
}
```

## Подписка (Observer Pattern)

```typescript
private listeners = new Set<(state: AppState) => void>();

subscribe(listener: (state: AppState) => void): () => void {
  this.listeners.add(listener);
  return () => this.listeners.delete(listener);
}

private notify(): void {
  const state = this.getState();
  for (const listener of this.listeners) {
    listener(state);
  }
}
```

Подписчики: IPC Bridge (рассылает в Renderer через webContents.send).

## Мульти-репо

StateManager хранит:
- `openRepos: RepoInfo[]` — список открытых репозиториев
- `activeRepoIndex: number` — текущий

`switchRepo()` меняет `activeRepoIndex`, устанавливает cwd в GitExecutor, вызывает `refreshAll()`.

## Edge Cases

- Репозиторий не инициализирован (нет .git) → пустой state, сообщение в UI
- Пустой репозиторий (нет коммитов) → branches=[], commits=[]
- Отсоединённый HEAD (detached) → currentBranch = 'HEAD (отсоединённый)'
- Shallow clone → ограниченная история, граф может быть неполным
