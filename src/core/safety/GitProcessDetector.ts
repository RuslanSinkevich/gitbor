import { execFile } from 'child_process';
import type { GitProcessInfo } from '../git/types';
import { mainLogger } from '../utils/Logger';

interface ExecResult { stdout: string; stderr: string }

/**
 * Тонкая обёртка над execFile без promisify(). promisify обнимает
 * имплементацию модуля в момент `import`, что делает её невидимой
 * для `vi.mock('child_process')` (мок применяется к namespace,
 * но захваченная promisified-функция продолжает звать оригинал).
 */
function execFileAsync(
  file: string,
  args: string[],
  options: { timeout: number; windowsHide?: boolean },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * Cross-platform детекция запущенных git-процессов. Используется
 * `PreflightChecks` для информативного диалога при свежем `index.lock`:
 * показать юзеру список параллельных git-процессов с pid и командой,
 * чтобы он мог осознанно решить — ждать / прибить / отменить.
 *
 * НЕ блокирующая фича: если shell-вызов упал / timeout — возвращаем
 * пустой массив. Юзер всё равно увидит generic "lock held" диалог.
 */

const TIMEOUT_MS = 2000;

interface DetectorEnv {
  platform: NodeJS.Platform;
}

/**
 * Платформа берётся из аргумента, а не из глобала: позволяет тестам
 * прогнать обе ветки без переопределения `process.platform` (которое
 * в новых node throws в strict mode).
 */
export async function findGitProcesses(
  repoPath?: string,
  env: DetectorEnv = { platform: process.platform },
): Promise<GitProcessInfo[]> {
  try {
    if (env.platform === 'win32') {
      return await findGitProcessesWindows(repoPath);
    }
    return await findGitProcessesPosix(repoPath);
  } catch (err) {
    // Любая ошибка детектора — best-effort, не блокирующий путь.
    mainLogger.debug(`gitProcessDetector: failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function findGitProcessesWindows(repoPath?: string): Promise<GitProcessInfo[]> {
  // Get-CimInstance быстрее WMIC и не deprecated; формат JSON.
  // -NoProfile / -NonInteractive: исключает $PROFILE и инпут-prompts.
  const ps =
    "Get-CimInstance Win32_Process -Filter \"Name='git.exe'\" | " +
    'Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress';
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { timeout: TIMEOUT_MS, windowsHide: true },
  );

  const raw = stdout.trim();
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];

  const procs: GitProcessInfo[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const pid = typeof obj.ProcessId === 'number' ? obj.ProcessId : Number(obj.ProcessId);
    if (!Number.isFinite(pid)) continue;
    const command = typeof obj.CommandLine === 'string' ? obj.CommandLine : '';
    procs.push({ pid, command, cwd: undefined });
  }

  return repoPath ? filterByRepo(procs, repoPath) : procs;
}

async function findGitProcessesPosix(repoPath?: string): Promise<GitProcessInfo[]> {
  // ps -ax -o pid,command — POSIX-минимум, работает на macOS/Linux.
  const { stdout } = await execFileAsync(
    'ps',
    ['-ax', '-o', 'pid=,command='],
    { timeout: TIMEOUT_MS },
  );

  const lines = stdout.split('\n');
  const procs: GitProcessInfo[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const command = m[2];

    // \bgit\b — слово git, не grep-substring. Отсекает строки про vim, grep, и т.п.
    if (!/(?:^|[/\s])git(?:\s|$)/.test(command)) continue;

    procs.push({ pid, command });
  }

  return repoPath ? filterByRepo(procs, repoPath) : procs;
}

/**
 * Фильтр по cwd репо. На windows cwd процесса не доставали (нужны
 * админ-права на OpenProcess), поэтому фильтруем по подстроке в
 * CommandLine — `git -C <repoPath>` или git, запущенный из этой папки
 * (часто включает абсолютный путь в аргументах).
 */
function filterByRepo(procs: GitProcessInfo[], repoPath: string): GitProcessInfo[] {
  const norm = repoPath.replace(/\\/g, '/').toLowerCase();
  return procs.filter(p => {
    if (p.cwd && p.cwd.replace(/\\/g, '/').toLowerCase().startsWith(norm)) return true;
    if (p.command.toLowerCase().replace(/\\/g, '/').includes(norm)) return true;
    return false;
  });
}
