import * as os from 'os';
import * as path from 'path';

export interface DangerousRepoCheck {
  dangerous: boolean;
  reason?: string;
}

/**
 * Регистронезависимая FS — Windows и macOS. Под мокинг через
 * Object.defineProperty(process, 'platform', ...) читаем `process.platform`
 * каждый раз заново, без кэша.
 */
function isCaseInsensitiveFs(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

/**
 * «Опасные» корни — каталоги, в которых случайно может оказаться `.git`
 * (типичный сценарий: `git init` в домашней папке) и любые попытки GitBor
 * работать с ними в качестве репо приводят к фризу UI и `git status` на
 * сотнях тысяч файлов.
 *
 * Решение продуктовое: в таких путях НЕ запускаем git-логику и watcher
 * worktree. Возвращаем пользователю явный отказ.
 */
export function isDangerousRepoRoot(repoPath: string): DangerousRepoCheck {
  if (!repoPath || typeof repoPath !== 'string') {
    return { dangerous: true, reason: 'invalidPath' };
  }

  const isWin = process.platform === 'win32';
  // Платформо-специфичный resolve, чтобы корректно работала ветка POSIX
  // под мокнутым `process.platform = 'darwin'` на реальном Windows-runtime
  // (иначе path.resolve('/Applications') превращается в 'C:\\Applications').
  // На реальных Linux/macOS поведение не меняется (path === path.posix).
  const normalized = isWin ? path.win32.resolve(repoPath) : path.posix.resolve(repoPath);
  const lower = normalized.toLowerCase();

  // Корень диска / FS root.
  // Windows: 'c:\\' / 'c:\'. Unix: '/'.
  if (isWin) {
    if (/^[a-z]:[\\/]?$/i.test(normalized)) return { dangerous: true, reason: 'driveRoot' };
  } else {
    if (normalized === '/') return { dangerous: true, reason: 'driveRoot' };
  }

  // Домашняя папка текущего пользователя.
  try {
    const home = isWin ? path.win32.resolve(os.homedir()) : path.posix.resolve(os.homedir());
    if (home && (normalized === home || lower === home.toLowerCase())) {
      return { dangerous: true, reason: 'homeDirectory' };
    }
  } catch { /* ignore */ }

  // env-fallbacks (USERPROFILE на Win, HOME на Unix).
  const envHome = process.env.USERPROFILE || process.env.HOME;
  if (envHome) {
    const envResolved = (isWin ? path.win32.resolve(envHome) : path.posix.resolve(envHome)).toLowerCase();
    if (lower === envResolved) return { dangerous: true, reason: 'homeDirectory' };
  }

  // Корни «всех пользователей».
  if (isWin) {
    // \Users без подкаталога — это родитель всех профилей. Никто не делает
    // git репо в C:\Users.
    if (/[\\/]Users[\\/]?$/i.test(normalized)) return { dangerous: true, reason: 'usersRoot' };

    // Берём реальные системные корни из env (SystemRoot, ProgramFiles,
    // ProgramData), а не хардкодим 'c:\'. На машинах, где Windows стоит
    // на D:/E:/..., старая проверка не ловила ничего.
    const winSystemRoots: string[] = [];
    const sysRoot = process.env.SystemRoot;
    const progFiles = process.env.ProgramFiles;
    const progFilesX86 = process.env['ProgramFiles(x86)'];
    const progData = process.env.ProgramData;
    if (sysRoot) winSystemRoots.push(path.win32.resolve(sysRoot).toLowerCase());
    if (progFiles) winSystemRoots.push(path.win32.resolve(progFiles).toLowerCase());
    if (progFilesX86) winSystemRoots.push(path.win32.resolve(progFilesX86).toLowerCase());
    if (progData) winSystemRoots.push(path.win32.resolve(progData).toLowerCase());
    // Безопасный fallback на C:, если переменные окружения почему-то пусты
    // (например, Windows Sandbox без полного env).
    if (winSystemRoots.length === 0) {
      winSystemRoots.push('c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\programdata');
    }
    if (winSystemRoots.some(r => lower === r || lower.startsWith(r + '\\'))) {
      return { dangerous: true, reason: 'systemDirectory' };
    }
  } else {
    const posixSystemRoots = ['/etc', '/usr', '/var', '/bin', '/sbin', '/lib', '/boot', '/root', '/Users', '/home', '/Library', '/System', '/opt', '/Applications'];
    const ci = isCaseInsensitiveFs();
    const cmp = ci ? normalized.toLowerCase() : normalized;
    const matches = (r: string): boolean => {
      const rcmp = ci ? r.toLowerCase() : r;
      return cmp === rcmp || cmp.startsWith(rcmp + '/');
    };
    if (posixSystemRoots.some(matches)) {
      // /home и /Users сами по себе — корень всех профилей; подкаталог в них
      // (/home/alice) допустим только если это НЕ ровно домашняя папка
      // текущего юзера (она уже отбита выше).
      const usersRootSet = ci ? ['/home', '/users'] : ['/home', '/Users'];
      if (usersRootSet.includes(cmp)) {
        return { dangerous: true, reason: 'usersRoot' };
      }
      // /home/alice/projects — норм. Запрещаем только если ровно совпало с
      // одним из системных корней или это его прямой потомок системного
      // (вроде /etc, /usr, /var, /Applications).
      const prohibited = ['/etc', '/usr', '/var', '/bin', '/sbin', '/lib', '/boot', '/root', '/Library', '/System', '/opt', '/Applications'];
      if (prohibited.some(matches)) {
        return { dangerous: true, reason: 'systemDirectory' };
      }
    }
  }

  return { dangerous: false };
}
