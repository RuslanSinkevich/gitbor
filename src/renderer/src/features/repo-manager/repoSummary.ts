import type { AppState } from '../../types';

export interface RepoSummary {
  branches: number;
  tags: number;
  remotes: string[];
  uncommitted: number;
  lastCommitMessage: string;
  lastCommitAuthor: string;
  lastCommitDate: number;
}

export function extractSummary(state: AppState): RepoSummary | null {
  if (!state.repoPath) return null;
  const lastCommit = state.commits[0];
  return {
    branches: state.branches.filter(b => !b.isRemote).length,
    tags: state.tags.length,
    remotes: state.remotes.map(r => r.name),
    uncommitted: state.stagedFiles.length + state.unstagedFiles.length,
    lastCommitMessage: lastCommit?.subject ?? '',
    lastCommitAuthor: lastCommit?.authorName ?? '',
    lastCommitDate: lastCommit?.authorDate ?? 0,
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
