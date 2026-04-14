import { t } from '../../i18n';
import type { RepoStats, AuthorStats } from '../../types';
import { ActivityBars } from './ActivityBars';
import s from './Statistics.module.css';

interface Props {
  data: RepoStats;
  onSelectAuthor: (author: AuthorStats) => void;
}

export function OverviewView({ data, onSelectAuthor }: Props) {
  const loc = t();
  const sl = loc.stats;
  const maxCommits = data.authors.length > 0 ? data.authors[0].commits : 1;

  return (
    <>
      <div className={s.summaryRow}>
        <div className={s.statCard}>
          <div className={s.statValue}>{data.totalCommits.toLocaleString()}</div>
          <div className={s.statLabel}>{sl.totalCommits}</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statValue}>{data.authors.length}</div>
          <div className={s.statLabel}>{sl.totalAuthors}</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statValue} title={data.period.from}>{data.period.from || '—'}</div>
          <div className={s.statLabel}>{sl.firstCommit}</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statValue} title={data.period.to}>{data.period.to || '—'}</div>
          <div className={s.statLabel}>{sl.lastCommit}</div>
        </div>
      </div>

      {data.monthlyCounts.length > 0 && (
        <div className={s.barsSection}>
          <h3 className={s.sectionTitle}>{sl.monthlyActivity}</h3>
          <ActivityBars data={data.monthlyCounts} />
        </div>
      )}

      <div>
        <h3 className={s.sectionTitle}>{sl.topContributors}</h3>
        <ul className={s.authorList}>
          {data.authors.map((author, idx) => (
            <li key={`${author.name}\x00${author.email}`} className={s.authorItem} onClick={() => onSelectAuthor(author)}>
              <span className={s.authorRank}>{idx + 1}</span>
              <div className={s.authorInfo}>
                <div className={s.authorName}>{author.name}</div>
                <div className={s.authorEmail}>{author.email}</div>
              </div>
              <div className={s.authorMeta}>
                <div className={s.authorCommits}>{author.commits.toLocaleString()}</div>
                <div className={s.authorPct}>{author.percentage}%</div>
                <div className={s.authorBar}>
                  <div className={s.authorBarFill} style={{ width: `${(author.commits / maxCommits) * 100}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
