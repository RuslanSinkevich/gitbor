import { GitExecutor } from '../git/GitExecutor';
import type { RepoSummaryDto, RepoSummaryBranchDto, RepoSummaryTagDto, RepoSummaryCommitDto } from '../bridge/messages';

/**
 * Лёгкий сводный отчёт по произвольному пути для UI «Менеджер репозиториев».
 * Не трогает StateManager / activity, не делает fetch — только локальное чтение.
 * Все ошибки отдельных команд глушим, чтобы один сломанный pack/ref не убивал
 * весь summary. При невалидном пути (нет .git / не репо) возвращаем
 * `valid: false` с пустыми полями.
 */
function emptyDto(valid: boolean): RepoSummaryDto {
  return {
    valid,
    branches: [],
    tags: [],
    remotes: [],
    uncommitted: 0,
    recentCommits: [],
    lastCommitMessage: '',
    lastCommitAuthor: '',
    lastCommitDate: 0,
  };
}

async function safeBranches(git: GitExecutor): Promise<RepoSummaryBranchDto[]> {
  try {
    const r = await git.exec(['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(HEAD)', 'refs/heads/']);
    if (r.exitCode !== 0) return [];
    return r.stdout.split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [name, hash, head] = line.split('\0');
        return { name: name ?? '', hash: hash ?? '', isCurrent: head === '*' };
      })
      .filter(b => b.name.length > 0);
  } catch {
    return [];
  }
}

async function safeTags(git: GitExecutor): Promise<RepoSummaryTagDto[]> {
  try {
    const r = await git.exec(['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%00%(objectname)', 'refs/tags/']);
    if (r.exitCode !== 0) return [];
    return r.stdout.split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [name, hash] = line.split('\0');
        return { name: name ?? '', hash: hash ?? '' };
      })
      .filter(tag => tag.name.length > 0)
      .slice(0, 50);
  } catch {
    return [];
  }
}

async function safeRemotes(git: GitExecutor): Promise<string[]> {
  try {
    const r = await git.exec(['remote', '-v']);
    if (r.exitCode !== 0) return [];
    const set = new Set<string>();
    for (const line of r.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const name = trimmed.split(/\s+/)[0];
      if (name) set.add(name);
    }
    return [...set];
  } catch {
    return [];
  }
}

async function safeUncommitted(git: GitExecutor): Promise<number> {
  try {
    const r = await git.exec(['status', '--porcelain=v1', '--untracked-files=all']);
    if (r.exitCode !== 0) return 0;
    return r.stdout.split('\n').filter(line => line.length > 0).length;
  } catch {
    return 0;
  }
}

async function safeRecentCommits(git: GitExecutor): Promise<RepoSummaryCommitDto[]> {
  try {
    const r = await git.exec(['log', '-n', '8', '--format=%H%x00%s%x00%an%x00%at']);
    if (r.exitCode !== 0) return [];
    return r.stdout.split('\n')
      .filter(line => line.length > 0)
      .map(line => {
        const [hash, subject, authorName, ts] = line.split('\0');
        return {
          hash: hash ?? '',
          subject: subject ?? '',
          authorName: authorName ?? '',
          authorDate: ts ? parseInt(ts, 10) * 1000 : 0,
        };
      });
  } catch {
    return [];
  }
}

export async function computeRepoSummary(path: string): Promise<RepoSummaryDto> {
  if (!path) return emptyDto(false);
  const git = new GitExecutor(path);

  try {
    const probe = await git.exec(['rev-parse', '--is-inside-work-tree']);
    if (probe.exitCode !== 0 || probe.stdout.trim() !== 'true') {
      return emptyDto(false);
    }
  } catch {
    return emptyDto(false);
  }

  const [branches, tags, remotes, uncommitted, recentCommits] = await Promise.all([
    safeBranches(git),
    safeTags(git),
    safeRemotes(git),
    safeUncommitted(git),
    safeRecentCommits(git),
  ]);

  const head = recentCommits[0];
  return {
    valid: true,
    branches,
    tags,
    remotes,
    uncommitted,
    recentCommits,
    lastCommitMessage: head?.subject ?? '',
    lastCommitAuthor: head?.authorName ?? '',
    lastCommitDate: head?.authorDate ?? 0,
  };
}
