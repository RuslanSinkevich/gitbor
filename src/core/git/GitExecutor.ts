import { execFile, spawn, ChildProcess } from 'child_process';
import { GitExecOptions, GitExecResult } from './types';
import { Logger } from '../utils/Logger';

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

export class GitExecutor {
  private readonly activeProcesses = new Set<ChildProcess>();
  private readonly logger: Logger;

  constructor(private defaultCwd: string) {
    this.logger = new Logger('SkyFork Git');
    this.logger.init();
  }

  async exec(args: string[], options?: GitExecOptions): Promise<GitExecResult> {
    const cwd = options?.cwd ?? this.defaultCwd;
    const timeout = options?.timeout ?? 30_000;
    const maxBuffer = options?.maxBuffer ?? 50 * 1024 * 1024;
    const startTime = Date.now();

    const fullArgs = ['-c', 'core.quotePath=false', ...args];

    if (options?.stdin) {
      return this.execWithStdin(fullArgs, options.stdin, cwd, timeout, maxBuffer, args);
    }

    this.logger.log(`exec: git ${args.join(' ')}  [cwd: ${cwd}]`);

    return new Promise<GitExecResult>((resolve, reject) => {
      const proc = execFile(
        'git',
        fullArgs,
        { cwd, timeout, maxBuffer, windowsHide: true },
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
            this.logger.error(gitError.message);
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
            this.logger.warn(`killed: timeout after ${duration}ms`);
            reject(gitError);
            return;
          }

          const exitCode = error
            ? typeof (error as { code?: unknown }).code === 'number'
              ? ((error as { code: number }).code)
              : 1
            : 0;

          this.logger.log(`done: exit=${exitCode} duration=${duration}ms`);

          resolve({ stdout, stderr, exitCode, duration });
        }
      );

      this.activeProcesses.add(proc);
    });
  }

  private execWithStdin(
    fullArgs: string[], stdin: string, cwd: string,
    timeout: number, _maxBuffer: number, displayArgs: string[],
  ): Promise<GitExecResult> {
    const startTime = Date.now();
    this.logger.log(`exec(stdin): git ${displayArgs.join(' ')}  [cwd: ${cwd}]`);

    return new Promise<GitExecResult>((resolve, reject) => {
      const proc = spawn('git', fullArgs, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.activeProcesses.add(proc);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.activeProcesses.delete(proc);
        const duration = Date.now() - startTime;
        this.logger.log(`done(stdin): exit=${code ?? 1} duration=${duration}ms`);
        resolve({ stdout, stderr, exitCode: code ?? 1, duration });
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

  killAll(): void {
    for (const proc of this.activeProcesses) {
      proc.kill('SIGTERM');
    }
    this.activeProcesses.clear();
  }

  setCwd(cwd: string): void {
    this.defaultCwd = cwd;
  }

  getCwd(): string {
    return this.defaultCwd;
  }
}
