# 03 — GitExecutor

## Слой: Git Layer
## Файл: `src/core/git/GitExecutor.ts`
## Зависимости: types.ts

---

## Назначение

Единственная точка в системе, которая вызывает `git`. Все модули обращаются к git только через GitExecutor. Никто не вызывает `child_process` напрямую.

Переиспользуется из SkyFork. Отличие: логирование через файл/консоль вместо VS Code OutputChannel.

## Интерфейс

```typescript
class GitExecutor {
  constructor(private defaultCwd: string, private gitPath?: string)

  async exec(args: string[], options?: GitExecOptions): Promise<GitExecResult>

  killAll(): void

  setCwd(cwd: string): void

  getCwd(): string
}
```

## Реализация

```typescript
import { execFile, ChildProcess } from 'child_process';

class GitExecutor {
  private activeProcesses: Set<ChildProcess> = new Set();

  constructor(private defaultCwd: string, private gitPath: string = 'git') {}

  async exec(args: string[], options?: GitExecOptions): Promise<GitExecResult> {
    const cwd = options?.cwd ?? this.defaultCwd;
    const timeout = options?.timeout ?? 30_000;
    const maxBuffer = options?.maxBuffer ?? 50 * 1024 * 1024;
    const startTime = Date.now();

    this.log('exec', `git ${args.join(' ')}`, cwd);

    return new Promise((resolve, reject) => {
      const proc = execFile(this.gitPath, args, { cwd, timeout, maxBuffer },
        (error, stdout, stderr) => {
          this.activeProcesses.delete(proc);
          const duration = Date.now() - startTime;
          const exitCode = error?.code ?? 0;

          this.log('done', `exit=${exitCode} duration=${duration}ms`);

          if (error && error.killed) {
            reject(new GitError('Git process was killed (timeout)', args.join(' '), -1, stderr));
            return;
          }

          resolve({ stdout, stderr, exitCode: typeof exitCode === 'number' ? exitCode : 1, duration });
        }
      );

      this.activeProcesses.add(proc);
    });
  }

  killAll(): void {
    for (const proc of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
  }
}
```

## Отличие от SkyFork: путь к git

В SkyFork git ищется через системный PATH или VS Code built-in git.
В SkyFork — bundled git (встроенный в приложение):

```typescript
constructor(private defaultCwd: string, private gitPath: string = 'git') {}
```

Путь к git определяется при инициализации приложения (см. 16-MAIN-PROCESS.md):

```
1. resources/git/{platform}/git → если есть, использовать
2. SkyFork_GIT_PATH → если задана, использовать
3. Системный git (which/where) → если есть, использовать
4. Ошибка: "Git не найден"
```

## GitError

```typescript
class GitError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    super(message);
    this.name = 'GitError';
  }
}
```

## Логирование

В SkyFork — VS Code OutputChannel.
В SkyFork — файловый лог + console:

```
[SkyFork] 14:23:05 exec: git log --all --max-count=500 --format=...
[SkyFork] 14:23:05 done: exit=0 duration=127ms
```

Лог-файл: `%APPDATA%/SkyFork/logs/git.log` (Windows) / `~/.config/SkyFork/logs/git.log` (Linux).

## Edge Cases

- **Git не установлен / bundled git повреждён**: exec бросает ошибку → GitError с понятным сообщением
- **Таймаут**: процесс убивается через timeout → GitError "process was killed"
- **Огромный вывод**: maxBuffer 50MB. Если не хватит — GitError
- **Параллельные вызовы**: GitExecutor не блокирует — это задача OperationQueue
- **Закрытие приложения**: killAll() убивает все процессы (app.on('before-quit'))
- **Путь с пробелами/кириллицей**: execFile обрабатывает корректно (не shell)
