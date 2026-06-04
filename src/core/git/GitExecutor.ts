import { execFile, spawn, ChildProcess } from 'child_process';
import { GitExecOptions, GitExecResult } from './types';
import { mainLogger } from '../utils/Logger';
import { getCurrentActivityId } from '../activity/activityContext';
import { gitActivityStore } from '../activity/GitActivityStore';

export class GitError extends Error {
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

/**
 * Mutating / интерактивные / сетевые git-команды, которые легитимно
 * могут идти долго: pre-commit / post-merge / post-checkout хуки на
 * больших монорепо (eslint+prettier по сотням файлов), сетевые
 * операции на медленном канале, большие чекауты. Им мы даём 15 минут
 * вместо общего 30s read-only таймаута.
 *
 * Read-only команды (status, log, diff, rev-parse, for-each-ref ...)
 * не должны висеть на здоровом репо; для них общий 30s таймаут — это
 * ровно та safety net, которая нужна на случай зависшего lock-файла
 * или больной ФС.
 */
const LONG_RUNNING_COMMANDS = new Set<string>([
  'commit',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'pull',
  'push',
  'fetch',
  'clone',
  'checkout',
]);
const LONG_RUNNING_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export class GitExecutor {
  private readonly activeProcesses = new Set<ChildProcess>();
  private static stderrInspector: ((stderr: string) => void) | null = null;

  private static resolveTimeout(args: string[], explicit: number | undefined): number {
    if (typeof explicit === 'number') return explicit;
    const head = args[0];
    if (head && LONG_RUNNING_COMMANDS.has(head)) return LONG_RUNNING_TIMEOUT_MS;
    return DEFAULT_TIMEOUT_MS;
  }

  /**
   * Регистрирует глобальный инспектор stderr. Используется
   * `LongPathSuggester` для разовой подсказки про `core.longpaths`.
   * Регистрируется один раз из main bootstrap; не зависит от текущего
   * экземпляра GitExecutor (в приложении один на весь main).
   */
  static setStderrInspector(fn: ((stderr: string) => void) | null): void {
    GitExecutor.stderrInspector = fn;
  }

  private static notifyStderr(stderr: string): void {
    const fn = GitExecutor.stderrInspector;
    if (!fn || !stderr) return;
    try {
      fn(stderr);
    } catch {
      // Inspector — диагностика, его падения никогда не должны влиять на git-операцию.
    }
  }

  constructor(private defaultCwd: string) {
    // Logger общий через `mainLogger` singleton: уровень/файл-вывод
    // настраиваются единожды в `main.ts` через `configureMainLogger`.
    // Раньше каждый GitExecutor открывал свой файл-стрим — это давало
    // дубли в логе и не выключалось в prod.
  }

  async exec(args: string[], options?: GitExecOptions): Promise<GitExecResult> {
    const cwd = options?.cwd ?? this.defaultCwd;
    const timeout = GitExecutor.resolveTimeout(args, options?.timeout);
    const maxBuffer = options?.maxBuffer ?? 50 * 1024 * 1024;
    const startTime = Date.now();

    const fullArgs = ['-c', 'core.quotePath=false', ...args];

    if (options?.stdin) {
      return this.execWithStdin(fullArgs, options.stdin, cwd, timeout, maxBuffer, args, options?.env);
    }

    mainLogger.debug(`git exec: ${this.sanitizeArgs(args)}  [cwd: ${cwd}]`);

    return new Promise<GitExecResult>((resolve, reject) => {
      const proc = execFile(
        'git',
        fullArgs,
        { cwd, timeout, maxBuffer, windowsHide: true, env: options?.env ? { ...process.env, ...options.env } : undefined },
        (error, stdout, stderr) => {
          this.activeProcesses.delete(proc);
          const duration = Date.now() - startTime;

          if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            const gitError = new GitError(
              'Git is not installed or not in PATH',
              args.join(' '),
              -1,
              ''
            );
            mainLogger.error(`git: ${gitError.message}`);
            reject(gitError);
            return;
          }

          if (error && error.killed) {
            const gitError = new GitError(
              `Git process was killed (timeout ${timeout}ms)`,
              args.join(' '),
              -1,
              stderr
            );
            mainLogger.warn(`git killed: timeout after ${duration}ms`);
            reject(gitError);
            return;
          }

          const exitCode = error
            ? typeof (error as NodeJS.ErrnoException & { status?: number }).status === 'number'
              ? (error as NodeJS.ErrnoException & { status: number }).status
              : 1
            : 0;

          mainLogger.debug(`git done: exit=${exitCode} duration=${duration}ms`);

          this.reportToActivity(args, cwd, stdout, stderr, exitCode, duration, startTime);
          if (exitCode !== 0) GitExecutor.notifyStderr(stderr);

          resolve({ stdout, stderr, exitCode, duration });
        }
      );

      this.activeProcesses.add(proc);
    });
  }

  /**
   * Тот же `exec`, но stdout/stderr возвращаются как `Buffer` — без
   * декодирования в UTF-8. Нужно для команд, где исходный файл может
   * быть в legacy-кодировке (CP1251 в старых .sql/.pas), а
   * `execFile`'s default-utf8 превратил бы кириллицу в кракозябры
   * (см. `decodeGitText` в utils/textEncoding).
   */
  async execBuffer(args: string[], options?: GitExecOptions): Promise<{
    stdout: Buffer; stderr: Buffer; exitCode: number; duration: number;
  }> {
    const cwd = options?.cwd ?? this.defaultCwd;
    const timeout = GitExecutor.resolveTimeout(args, options?.timeout);
    const startTime = Date.now();

    const fullArgs = ['-c', 'core.quotePath=false', ...args];

    mainLogger.debug(`git exec(buffer): ${this.sanitizeArgs(args)}  [cwd: ${cwd}]`);

    return new Promise((resolve, reject) => {
      const proc = spawn('git', fullArgs, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options?.env ? { ...process.env, ...options.env } : undefined,
      });
      this.activeProcesses.add(proc);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      proc.stdout?.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
      }, timeout);

      proc.on('close', (code, signal) => {
        clearTimeout(timer);
        this.activeProcesses.delete(proc);
        const duration = Date.now() - startTime;
        const stdout = Buffer.concat(stdoutChunks);
        const stderr = Buffer.concat(stderrChunks);
        const stderrStr = stderr.toString('utf8');

        if (signal === 'SIGTERM') {
          const gitError = new GitError(
            `Git process was killed (timeout ${timeout}ms)`,
            args.join(' '), -1, stderrStr,
          );
          mainLogger.warn(`git killed(buffer): timeout after ${duration}ms`);
          reject(gitError);
          return;
        }

        const exitCode = code ?? 1;
        mainLogger.debug(`git done(buffer): exit=${exitCode} duration=${duration}ms`);
        this.reportToActivity(args, cwd, stdout.toString('utf8'), stderrStr, exitCode, duration, startTime);
        if (exitCode !== 0) GitExecutor.notifyStderr(stderrStr);
        resolve({ stdout, stderr, exitCode, duration });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(proc);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new GitError('Git is not installed or not in PATH', args.join(' '), -1, ''));
        } else {
          reject(err);
        }
      });
    });
  }

  private reportToActivity(
    args: string[],
    cwd: string,
    stdout: string,
    stderr: string,
    exitCode: number,
    duration: number,
    startedAt: number,
  ): void {
    const id = getCurrentActivityId();
    if (!id) return;
    gitActivityStore.appendCommand(id, {
      args: [...args],
      cwd,
      exitCode,
      stdout,
      stderr,
      durationMs: duration,
      startedAt,
    });
  }

  private execWithStdin(
    fullArgs: string[], stdin: string, cwd: string,
    timeout: number, _maxBuffer: number, displayArgs: string[],
    env?: Record<string, string>,
  ): Promise<GitExecResult> {
    const startTime = Date.now();
    mainLogger.debug(`git exec(stdin): ${this.sanitizeArgs(displayArgs)}  [cwd: ${cwd}]`);

    return new Promise<GitExecResult>((resolve, reject) => {
      const proc = spawn('git', fullArgs, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : undefined });
      this.activeProcesses.add(proc);

      // Накапливаем чанки в Buffer[] и склеиваем один раз через Buffer.concat:
      // строковая конкатенация (`s += chunk.toString()`) на больших stdout (status
      // на 30+ МБ untracked) плодит миллионы временных строк → GC-давление и
      // фриз main thread. Buffer.concat — O(N) без промежуточных аллокаций.
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk); });
      proc.stderr.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.activeProcesses.delete(proc);
        const duration = Date.now() - startTime;
        const exitCode = code ?? 1;
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        mainLogger.debug(`git done(stdin): exit=${exitCode} duration=${duration}ms`);
        this.reportToActivity(displayArgs, cwd, stdout, stderr, exitCode, duration, startTime);
        if (exitCode !== 0) GitExecutor.notifyStderr(stderr);
        resolve({ stdout, stderr, exitCode, duration });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(proc);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new GitError('Git is not installed or not in PATH', displayArgs.join(' '), -1, ''));
        } else {
          reject(err);
        }
      });

      proc.stdin.write(stdin);
      proc.stdin.end();
    });
  }

  private sanitizeArgs(args: string[]): string {
    const REDACT_FLAGS = new Set(['-m', '-N', '-C', '--message']);
    const sanitized: string[] = [];
    let redactNext = false;
    for (const arg of args) {
      if (redactNext) {
        sanitized.push('<redacted>');
        redactNext = false;
      } else if (REDACT_FLAGS.has(arg)) {
        sanitized.push(arg);
        redactNext = true;
      } else {
        sanitized.push(arg);
      }
    }
    return sanitized.join(' ');
  }

  killAll(): number {
    const count = this.activeProcesses.size;
    for (const proc of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
    return count;
  }

  setCwd(cwd: string): void {
    this.defaultCwd = cwd;
  }

  getCwd(): string {
    return this.defaultCwd;
  }
}
