import { useEffect, useState } from 'react';
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
  loading: boolean;
  invalid: boolean;
  state: AppState;
  onRemove?: (path: string) => void;
}

/**
 * Skeleton не должен «моргать» на быстро отвечающих репо — задерживаем
 * показ индикатора. Если loading false до истечения задержки, индикатор
 * вообще не появится. 200мс — компромисс: дольше воспринимается как
 * зависание, меньше — мигает на любых SSD-репо.
 */
const LOADING_VISIBLE_DELAY_MS = 200;

export function RepoDetail({ selected, summary, loading, invalid, state, onRemove }: Props) {
  const rm = t().repoManager;

  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), LOADING_VISIBLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading]);

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

  if (invalid) {
    return (
      <div className={s.detailPanel}>
        <div className={s.detailHeader}>
          <h2 className={s.detailName}>{name}</h2>
          <div className={s.detailPath}>{path}</div>
        </div>
        <div className={s.detailEmpty}>
          <p>{rm.invalidRepo}</p>
          {onRemove && path && (
            <button className={s.detailOpenBtn} onClick={() => onRemove(path)}>
              {rm.removeFromList}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={s.detailPanel}>
      <div className={s.detailHeader}>
        <h2 className={s.detailName}>{name}</h2>
        <div className={s.detailPath}>{path}</div>
        <button className={s.detailOpenBtn} onClick={() => handleOpen(path)}>
          {rm.open}
        </button>
      </div>

      {!summary && showLoading && (
        <div className={s.detailEmpty}>
          <p>{rm.loading}</p>
        </div>
      )}

      {summary && (
        <>
          <div className={s.statsRow}>
            <div className={s.stat}>
              <span className={s.statValue}>{summary.branches}</span>
              <span className={s.statLabel}>{rm.branches}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statValue}>{summary.tags}</span>
              <span className={s.statLabel}>{rm.tags}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statValue}>{summary.uncommitted}</span>
              <span className={s.statLabel}>{rm.uncommittedFiles}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statValue}>{summary.remotes.length}</span>
              <span className={s.statLabel}>{rm.remotes}</span>
            </div>
          </div>

          {summary.lastCommitMessage && (
            <div className={s.detailSection}>
              <h3 className={s.detailSectionTitle}>{rm.lastCommit}</h3>
              <div className={s.detailRow}>
                <span className={`${s.detailRowIcon} ${s.commitColor}`}>●</span>
                <span className={s.detailRowName}>{summary.lastCommitMessage}</span>
                <span className={s.detailRowAuthor}>
                  <span className={s.authorDot} style={{ background: hashColor(summary.lastCommitAuthor) }} />
                  {summary.lastCommitAuthor}
                </span>
                <span className={s.detailRowDate}>{formatDate(summary.lastCommitDate)}</span>
              </div>
            </div>
          )}

          {summary.branchList.length > 0 && (
            <div className={s.detailSection}>
              <h3 className={s.detailSectionTitle}>{rm.branches}</h3>
              <div className={s.detailTable}>
                {summary.branchList.slice(0, 10).map(b => (
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

          {summary.tagList.length > 0 && (
            <div className={s.detailSection}>
              <h3 className={s.detailSectionTitle}>{rm.tags}</h3>
              <div className={s.detailTable}>
                {summary.tagList.slice(0, 10).map(tag => (
                  <div key={tag.name} className={s.detailRow}>
                    <span className={`${s.detailRowIcon} ${s.tagColor}`}>🏷</span>
                    <span className={s.detailRowName}>{tag.name}</span>
                    <span className={s.detailRowDesc}>{tag.hash.slice(0, 7)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.recentCommits.length > 0 && (
            <div className={s.detailSection}>
              <h3 className={s.detailSectionTitle}>{rm.commits}</h3>
              <div className={s.detailTable}>
                {summary.recentCommits.slice(0, 8).map(c => (
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
    </div>
  );
}
