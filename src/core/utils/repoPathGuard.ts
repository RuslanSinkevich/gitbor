import * as os from 'os';
import * as path from 'path';

export interface DangerousRepoCheck {
  dangerous: boolean;
  reason?: string;
}

/**
 * «Опасные» корни — каталоги, в которых случайно может оказаться `.git`
 * (типичный сценарий: `git init` в домашней папке) и любые попытки SkyFork
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

  const normalized = path.resolve(repoPath);
  const lower = normalized.toLowerCase();

  // Корень диска / FS root.
  // Windows: 'c:\\' / 'c:\'. Unix: '/'.
  if (process.platform === 'win32') {
    if (/^[a-z]:[\\/]?$/i.test(normalized)) return { dangerous: true, reason: 'driveRoot' };
  } else {
    if (normalized === '/') return { dangerous: true, reason: 'driveRoot' };
  }

  // Домашняя папка текущего пользователя.
  try {
    const home = path.resolve(os.homedir());
    if (home && (normalized === home || lower === home.toLowerCase())) {
      return { dangerous: true, reason: 'homeDirectory' };
    }
  } catch { /* ignore */ }

  // env-fallbacks (USERPROFILE на Win, HOME на Unix).
  const envHome = process.env.USERPROFILE || process.env.HOME;
  if (envHome) {
    const envResolved = path.resolve(envHome).toLowerCase();
    if (lower === envResolved) return { dangerous: true, reason: 'homeDirectory' };
  }

  // Корни «всех пользователей».
  if (process.platform === 'win32') {
    // \Users без подкаталога — это родитель всех профилей. Никто не делает
    // git репо в C:\Users.
    if (/[\\/]Users[\\/]?$/i.test(normalized)) return { dangerous: true, reason: 'usersRoot' };

    const winSystemRoots = [
      'c:\\windows',
      'c:\\program files',
      'c:\\program files (x86)',
      'c:\\programdata',
    ];
    if (winSystemRoots.some(r => lower === r || lower.startsWith(r + '\\'))) {
      return { dangerous: true, reason: 'systemDirectory' };
    }
  } else {
    const posixSystemRoots = ['/etc', '/usr', '/var', '/bin', '/sbin', '/lib', '/boot', '/root', '/Users', '/home', '/Library', '/System', '/opt'];
    if (posixSystemRoots.some(r => normalized === r || normalized.startsWith(r + '/'))) {
      // /home и /Users сами по себе — корень всех профилей; подкаталог в них
      // (/home/alice) допустим только если это НЕ ровно домашняя папка
      // текущего юзера (она уже отбита выше).
      if (normalized === '/home' || normalized === '/Users') {
        return { dangerous: true, reason: 'usersRoot' };
      }
      // /home/alice/projects — норм. Запрещаем только если ровно совпало с
      // одним из системных корней или это его прямой потомок системного
      // (вроде /etc, /usr, /var).
      const prohibited = ['/etc', '/usr', '/var', '/bin', '/sbin', '/lib', '/boot', '/root', '/Library', '/System', '/opt'];
      if (prohibited.some(r => normalized === r || normalized.startsWith(r + '/'))) {
        return { dangerous: true, reason: 'systemDirectory' };
      }
    }
  }

  return { dangerous: false };
}
