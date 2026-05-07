import type { AppState, RepoSummaryDto, RepoSummaryBranchDto, RepoSummaryTagDto, RepoSummaryCommitDto } from '../../types';

/**
 * Сводка по репо для UI «Менеджер репозиториев». Источников два:
 *  1) активный репо — берём прямо из live `AppState` (мгновенно, без IPC);
 *  2) любой другой пункт «Недавних» — догружаем `getRepoSummary` через IPC.
 *
 * Старые поля `branches: number` / `tags: number` оставлены для совместимости
 * со старым UI (статистика-блок), новые `branchList`/`tagList`/`recentCommits`
 * нужны для отрисовки таблиц справа без обращения к глобальному state.
 */
export interface RepoSummary {
  branches: number;
  tags: number;
  remotes: string[];
  uncommitted: number;
  lastCommitMessage: string;
  lastCommitAuthor: string;
  lastCommitDate: number;
  branchList: RepoSummaryBranchDto[];
  tagList: RepoSummaryTagDto[];
  recentCommits: RepoSummaryCommitDto[];
}

export function dtoToSummary(dto: RepoSummaryDto): RepoSummary {
  return {
    branches: dto.branches.length,
    tags: dto.tags.length,
    remotes: dto.remotes,
    uncommitted: dto.uncommitted,
    lastCommitMessage: dto.lastCommitMessage,
    lastCommitAuthor: dto.lastCommitAuthor,
    lastCommitDate: dto.lastCommitDate,
    branchList: dto.branches,
    tagList: dto.tags,
    recentCommits: dto.recentCommits,
  };
}

export function extractSummary(state: AppState): RepoSummary | null {
  if (!state.repoPath) return null;
  const lastCommit = state.commits[0];
  const localBranches = state.branches.filter(b => !b.isRemote);
  return {
    branches: localBranches.length,
    tags: state.tags.length,
    remotes: state.remotes.map(r => r.name),
    uncommitted: new Set([...state.stagedFiles.map(f => f.path), ...state.unstagedFiles.map(f => f.path)]).size,
    lastCommitMessage: lastCommit?.subject ?? '',
    lastCommitAuthor: lastCommit?.authorName ?? '',
    lastCommitDate: lastCommit?.authorDate ?? 0,
    branchList: localBranches.map(b => ({ name: b.name, hash: b.hash, isCurrent: b.isCurrent })),
    tagList: state.tags.map(tag => ({ name: tag.name, hash: tag.hash })),
    recentCommits: state.commits.slice(0, 8).map(c => ({
      hash: c.hash,
      subject: c.subject,
      authorName: c.authorName,
      authorDate: c.authorDate,
    })),
  };
}

export function formatDate(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = str.charCodeAt(i) + ((h << 5) - h);
  }
  return `hsl(${Math.abs(h) % 360}, 55%, 55%)`;
}
