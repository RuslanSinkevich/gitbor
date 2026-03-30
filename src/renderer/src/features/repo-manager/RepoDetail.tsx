import { t } from '../../i18n';
import type { AppState } from '../../types';
import type { RecentRepo } from './recentRepos';
import type { RepoSummary } from './repoSummary';
import { formatDate, hashColor } from './repoSummary';
import { postCommand } from '../../api';
import s from './RepoManager.module.css';

interface Props {
  selected: RecentRepo | undefined;
  summary: RepoSummary | null;
  state: AppState;
}

export function RepoDetail({ selected, summary, state }: Props) {
  const rm = t().repoManager;

  const handleOpen = (path: string) => postCommand({ type: 'openRepo', path });

  if (!selected && !summary) {
    return (
      <div className={s.detailPanel}>
        <div className={s.detailEmpty}>
          <h2>{rm.emptyTitle}</h2>
          <p>{rm.emptyText}</p>
        </div>
      </div>
    );
  }

  const name = selected?.name ?? state.repoName;
  const path = selected?.path ?? state.repoPath;
  const isCurrentRepo = path === state.repoPath;
  const sum = isCurrentRepo ? summary : null;

  return (
    <div className={s.detailPanel}>
      <div className={s.detailHeader}>
        <h2 className={s.detailName}>{name}</h2>
        <div className={s.detailPath}>{path}</div>
        <button className={s.detailOpenBtn} onClick={() => handleOpen(path)}>
          {rm.open}
        </button>
      </div>

      {sum && (
        <>
          <div className={s.statsRow}>
            <div className={s.stat}>
              <span className={s.statValue}>{sum.branches}</span>
              <span className={s.statLabel}>{rm.branches}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statValue}>{sum.tags}</span>
              <span className={s.statLabel}>{rm.tags}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statValue}>{sum.uncommitted}</span>
              <span className={s.statLabel}>{rm.uncommittedFiles}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statValue}>{sum.remotes.length}</span>
              <span className={s.statLabel}>{rm.remotes}</span>
            </div>
          </div>

          {sum.lastCommitMessage && (
            <div className={s.detailSection}>
              <h3 className={s.detailSectionTitle}>{rm.lastCommit}</h3>
              <div className={s.detailRow}>
                <span className={`${s.detailRowIcon} ${s.commitColor}`}>●</span>
                <span className={s.detailRowName}>{sum.lastCommitMessage}</span>
                <span className={s.detailRowAuthor}>
                  <span className={s.authorDot} style={{ background: hashColor(sum.lastCommitAuthor) }} />
                  {sum.lastCommitAuthor}
                </span>
                <span className={s.detailRowDate}>{formatDate(sum.lastCommitDate)}</span>
              </div>
            </div>
          )}

          {state.branches.filter(b => !b.isRemote).length > 0 && (
            <div className={s.detailSection}>
              <h3 className={s.detailSectionTitle}>{rm.branches}</h3>
              <div className={s.detailTable}>
                {state.branches.filter(b => !b.isRemote).slice(0, 10).map(b => (
                  <div key={b.name} className={s.detailRow}>
                    <span className={`${s.detailRowIcon} ${s.branchColor}`}>⎇</span>
                    <span className={s.detailRowName}>
                      {b.name}{b.isCurrent ? ' ★' : ''}
                    </span>
                    <span className={s.detailRowDesc}>{b.hash.slice(0, 7)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.tags.length > 0 && (
            <div className={s.detailSection}>
              <h3 className={s.detailSectionTitle}>{rm.tags}</h3>
              <div className={s.detailTable}>
                {state.tags.slice(0, 10).map(tag => (
                  <div key={tag.name} className={s.detailRow}>
                    <span className={`${s.detailRowIcon} ${s.tagColor}`}>🏷</span>
                    <span className={s.detailRowName}>{tag.name}</span>
                    <span className={s.detailRowDesc}>{tag.hash.slice(0, 7)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.commits.length > 0 && (
            <div className={s.detailSection}>
              <h3 className={s.detailSectionTitle}>{rm.commits}</h3>
              <div className={s.detailTable}>
                {state.commits.slice(0, 8).map(c => (
                  <div key={c.hash} className={s.detailRow}>
                    <span className={`${s.detailRowIcon} ${s.commitColor}`}>●</span>
                    <span className={s.detailRowName}>{c.subject}</span>
                    <span className={s.detailRowAuthor}>
                      <span className={s.authorDot} style={{ background: hashColor(c.authorName) }} />
                      {c.authorName}
                    </span>
                    <span className={s.detailRowDate}>{formatDate(c.authorDate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!sum && (
        <div className={s.detailEmpty}>
          <p>{rm.emptyText}</p>
        </div>
      )}
    </div>
  );
}
