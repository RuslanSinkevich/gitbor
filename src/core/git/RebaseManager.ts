import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { writeFile, readFile, access, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { GitExecutor } from './GitExecutor';
import type { RebaseTodoEntry, RebaseTodoList, RebaseProgress, OperationResult } from './types';
import { resolveGitDir } from './gitDir';

/**
 * GIT_EDITOR для `rebase -i` без терминала. Раньше git открывал vim, которого
 * у GUI нет, — reword/squash падали или вешали rebase.
 *  - reword: git зовёт редактор по разу на каждый reword, по порядку todo —
 *    берём следующий заголовок из очереди и заменяем первую строку (тело
 *    сообщения и комментарии остаются);
 *  - squash: «# This is a combination of …» — оставляем объединённое
 *    сообщение, которое git собрал сам.
 */
async function writeMessageEditor(workDir: string, entries: RebaseTodoEntry[]): Promise<string> {
  const queue = join(workDir, 'reword');
  await mkdir(queue);
  const rewords = entries.filter(e => e.action === 'reword');
  for (const [i, e] of rewords.entries()) {
    const subject = (e.newSubject ?? e.subject).replace(/\r?\n/g, ' ').trim() || e.subject;
    await writeFile(join(queue, String(i).padStart(4, '0')), `${subject}\n`, 'utf-8');
  }
  const q = queue.replace(/\\/g, '/');
  const script = [
    '#!/bin/sh',
    'f="$1"',
    "if grep -q '^# This is a combination of' \"$f\"; then exit 0; fi",
    `next=$(ls "${q}" 2>/dev/null | sort | head -n 1)`,
    '[ -z "$next" ] && exit 0',
    `{ cat "${q}/$next"; tail -n +2 "$f"; } > "$f.gitbor" && mv "$f.gitbor" "$f"`,
    `rm -f "${q}/$next"`,
    'exit 0',
    '',
  ].join('\n');
  const scriptPath = join(workDir, 'editor.sh');
  await writeFile(scriptPath, script, 'utf-8');
  return `sh "${scriptPath.replace(/\\/g, '/')}"`;
}

export class RebaseManager {
  constructor(private readonly git: GitExecutor) {}

  /**
   * Get the list of commits that would be rebased interactively.
   * `onto` is the target commit (e.g., a branch name or hash).
   */
  async getTodoList(onto: string): Promise<RebaseTodoList> {
    const result = await this.git.exec([
      'log', '--reverse', '--format=%H %h %s', `${onto}..HEAD`,
    ]);

    const entries: RebaseTodoEntry[] = result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [hash, shortHash, ...rest] = line.split(' ');
        return {
          action: 'pick' as const,
          hash,
          shortHash,
          subject: rest.join(' '),
        };
      });

    return { onto, entries };
  }

  /**
   * Execute interactive rebase with the given todo entries.
   * Uses GIT_SEQUENCE_EDITOR to inject the todo list.
   */
  async executeRebase(onto: string, entries: RebaseTodoEntry[]): Promise<OperationResult> {
    const todoContent = entries
      .filter(e => e.action !== 'drop')
      .map(e => `${e.action} ${e.hash} ${e.subject}`)
      .join('\n') + '\n';

    // Очередь reword-заголовков живёт в .git до конца rebase: после «edit» или
    // конфликта следующие reword идут уже из «Продолжить».
    const workDir = this.editorDir();
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });
    const todoPath = join(workDir, 'todo.txt');
    await writeFile(todoPath, todoContent, 'utf-8');
    const editor = await writeMessageEditor(workDir, entries);

    // Git invokes $GIT_SEQUENCE_EDITOR <file> through a POSIX shell
    // (even on Windows via Git-for-Windows MSYS2), so `cp` works everywhere.
    const safeTodoPath = todoPath.replace(/\\/g, '/');
    const editorCmd = `cp "${safeTodoPath}"`;

    try {
      const result = await this.git.exec(
        ['rebase', '-i', onto],
        {
          env: { GIT_SEQUENCE_EDITOR: editorCmd, GIT_EDITOR: editor },
        },
      );
      return {
        success: result.exitCode === 0,
        error: result.exitCode !== 0 ? result.stderr : undefined,
        rollbackAvailable: false,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        rollbackAvailable: false,
      };
    } finally {
      await this.cleanupEditorIfDone();
    }
  }

  private editorDir(): string {
    const cwd = this.git.getCwd();
    const gitDir = resolveGitDir(cwd);
    // Нет git-dir (битый путь, заглушка в тестах) — не создаём его сами, а берём
    // временную папку, привязанную к репо, чтобы «Продолжить» её нашёл.
    if (!existsSync(gitDir)) {
      return join(tmpdir(), `gitbor-rebase-${createHash('sha1').update(cwd).digest('hex').slice(0, 12)}`);
    }
    return join(gitDir, 'gitbor-rebase');
  }

  /** Редактор сообщений текущего rebase (см. writeMessageEditor) или «оставить как есть». */
  private messageEditor(): string {
    const script = join(this.editorDir(), 'editor.sh');
    return existsSync(script) ? `sh "${script.replace(/\\/g, '/')}"` : 'true';
  }

  private async cleanupEditorIfDone(): Promise<void> {
    if ((await this.getProgress()).inProgress) return;
    await rm(this.editorDir(), { recursive: true, force: true }).catch(() => { /* cleanup */ });
  }

  /**
   * Check if a rebase is currently in progress.
   */
  async getProgress(): Promise<RebaseProgress> {
    const repoPath = this.git.getCwd();
    const gitDir = resolveGitDir(repoPath);

    let dir: string;
    try {
      await access(join(gitDir, 'rebase-merge'));
      dir = join(gitDir, 'rebase-merge');
    } catch {
      try {
        await access(join(gitDir, 'rebase-apply'));
        dir = join(gitDir, 'rebase-apply');
      } catch {
        return { inProgress: false, currentStep: 0, totalSteps: 0, currentHash: '', currentAction: '' };
      }
    }

    let step = 0, total = 0, hash = '';
    const action = '';

    try {
      const msgnum = await readFile(join(dir, 'msgnum'), 'utf-8');
      step = parseInt(msgnum.trim(), 10);
    } catch {
      try {
        const next = await readFile(join(dir, 'next'), 'utf-8');
        step = parseInt(next.trim(), 10);
      } catch { /* empty */ }
    }

    try {
      const end = await readFile(join(dir, 'end'), 'utf-8');
      total = parseInt(end.trim(), 10);
    } catch {
      try {
        const last = await readFile(join(dir, 'last'), 'utf-8');
        total = parseInt(last.trim(), 10);
      } catch { /* empty */ }
    }

    try {
      const stopped = await readFile(join(dir, 'stopped-sha'), 'utf-8');
      hash = stopped.trim();
    } catch { /* empty */ }

    return { inProgress: true, currentStep: step, totalSteps: total, currentHash: hash, currentAction: action };
  }

  async continueRebase(): Promise<OperationResult> {
    // GIT_EDITOR=true — сообщение коммита оставляем как есть. Без этого git
    // открывал vim, которого у GUI нет: «Продолжить» падало или зависало.
    const result = await this.git.exec(['rebase', '--continue'], { env: { GIT_EDITOR: this.messageEditor() } });
    await this.cleanupEditorIfDone();
    return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined, rollbackAvailable: false };
  }

  async abortRebase(): Promise<OperationResult> {
    const result = await this.git.exec(['rebase', '--abort']);
    await this.cleanupEditorIfDone();
    return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined, rollbackAvailable: false };
  }

  async skipRebase(): Promise<OperationResult> {
    const result = await this.git.exec(['rebase', '--skip'], { env: { GIT_EDITOR: this.messageEditor() } });
    await this.cleanupEditorIfDone();
    return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined, rollbackAvailable: false };
  }
}
