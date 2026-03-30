# 13 — CommandHandler

## Слой: Application Layer
## Файл: `src/core/commands/CommandHandler.ts`
## Зависимости: types.ts, GitExecutor, OperationQueue, SafetyNet, StateManager

---

## Назначение

Оркестратор. Принимает команды от UI → решает как выполнить → координирует модули.
Каждая команда — отдельный метод. Добавить новую команду = добавить метод.

Адаптирован из SkyFork: вместо делегирования diff/merge в VS Code — собственные реализации на Monaco Editor.

## Интерфейс

```typescript
class CommandHandler {
  constructor(
    private git: GitExecutor,
    private queue: OperationQueue,
    private safety: SafetyNet,
    private state: StateManager
  ) {}

  // Read-операции (через queue.enqueueRead)
  async getState(): Promise<AppState>
  async getGraphData(maxCount: number): Promise<CommitGraphData>
  async getCommitDetails(hash: string): Promise<CommitDetail>

  // Write-операции (через queue.enqueueWrite + safety.wrapDestructive)
  async checkout(branch: string): Promise<OperationResult>
  async commit(message: string, amend: boolean): Promise<OperationResult>
  async fetch(): Promise<OperationResult>
  async pull(): Promise<OperationResult>
  async push(): Promise<OperationResult>
  async stash(message?: string): Promise<OperationResult>
  async stashPop(): Promise<OperationResult>
  async merge(branch: string, options?: MergeOptions): Promise<OperationResult<MergeResult>>

  // Ветки
  async createBranch(name: string, from: string): Promise<OperationResult>
  async renameBranch(oldName: string, newName: string): Promise<OperationResult>
  async deleteBranch(branch: string, force?: boolean): Promise<OperationResult>

  // Теги
  async createTag(name: string, ref: string): Promise<OperationResult>
  async deleteTag(name: string, remote?: boolean): Promise<OperationResult>

  // Коммиты
  async cherryPick(hash: string): Promise<OperationResult>
  async revert(hash: string): Promise<OperationResult>
  async resetTo(hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<OperationResult>

  // Файлы
  async stageFile(file: string): Promise<void>
  async unstageFile(file: string): Promise<void>
  async discardFileChanges(file: string): Promise<void>

  // Diff (собственная реализация)
  async getDiff(file: string, hash?: string): Promise<string>
  async getFileDiff(file: string, staged: boolean): Promise<string>

  // Мульти-репо
  async openRepo(path: string): Promise<void>
  async closeRepo(index: number): Promise<void>
  async switchRepo(index: number): Promise<void>
}
```

## Пример: checkout

```typescript
async checkout(branch: string): Promise<OperationResult> {
  return this.queue.enqueueWrite('checkout', async () => {
    return this.safety.wrapDestructive(
      'checkout',
      { branch },
      async () => {
        const result = await this.git.exec(['checkout', branch]);
        if (result.exitCode !== 0) {
          throw new GitError('Checkout failed', 'checkout', result.exitCode, result.stderr);
        }
      }
    );
  });
}
```

Цепочка: CommandHandler → OperationQueue → SafetyNet → GitExecutor

## Пример: fetch (неразрушающая)

```typescript
async fetch(): Promise<OperationResult> {
  return this.queue.enqueueWrite('fetch', async () => {
    const result = await this.git.exec(['fetch', '--all']);
    await this.state.refreshAll();
    return { success: result.exitCode === 0, rollbackAvailable: false };
  });
}
```

## Diff (отличие от SkyFork)

В SkyFork diff делегируется в VS Code (`vscode.commands.executeCommand('vscode.diff')`).
В SkyFork diff реализуется через Monaco Editor в Renderer Process.

CommandHandler возвращает raw diff данные, Renderer отображает:

```typescript
async getDiff(file: string, hash?: string): Promise<string> {
  if (hash) {
    // Diff конкретного коммита
    const result = await this.git.exec(['show', `${hash}:${file}`]);
    return result.stdout;
  }
  // Working tree diff
  const result = await this.git.exec(['diff', '--', file]);
  return result.stdout;
}

async getFileDiff(file: string, staged: boolean): Promise<string> {
  const args = staged ? ['diff', '--cached', '--', file] : ['diff', '--', file];
  const result = await this.git.exec(args);
  return result.stdout;
}
```

## Расширяемость

Добавить cherry-pick:
1. Добавить метод `cherryPick(hash: string)` в CommandHandler
2. Добавить тип `{ type: 'cherryPick'; hash: string }` в messages.ts
3. Добавить case в IPC Bridge
4. Добавить кнопку в UI

Четыре точки изменения, все очевидные. Ничего не ломается.
