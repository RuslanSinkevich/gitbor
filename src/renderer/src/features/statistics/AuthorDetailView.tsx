import { t } from '../../i18n';
import type { AuthorStats } from '../../types';
import { ContributionHeatmap } from './ContributionHeatmap';
import { ActivityBars } from './ActivityBars';
import s from './Statistics.module.css';

interface Props {
  author: AuthorStats;
}

export function AuthorDetailView({ author }: Props) {
  const loc = t();
  const sl = loc.stats;

  return (
    <>
      <div className={s.metricsRow}>
        <div className={s.metricCard}>
          <div className={s.metricValue}>{author.commits.toLocaleString()}</div>
          <div className={s.metricLabel}>{sl.totalCommits}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricValue}>{author.percentage}%</div>
          <div className={s.metricLabel}>{sl.share}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricValue}>{author.avgPerWeek}</div>
          <div className={s.metricLabel}>{sl.avgPerWeek}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricValue}>{author.mostActiveDay}</div>
          <div className={s.metricLabel}>{sl.mostActiveDay}</div>
        </div>
      </div>

      <div className={s.metricsRow}>
        <div className={s.metricCard}>
          <div className={s.metricValue}>{author.firstDate}</div>
          <div className={s.metricLabel}>{sl.firstCommit}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricValue}>{author.lastDate}</div>
          <div className={s.metricLabel}>{sl.lastCommit}</div>
        </div>
      </div>

      <div className={s.heatmapSection}>
        <h3 className={s.sectionTitle}>{sl.heatmap}</h3>
        <ContributionHeatmap dailyCounts={author.dailyCounts} authorName={author.name} />
      </div>

      {author.monthlyCounts.length > 0 && (
        <div className={s.barsSection}>
          <h3 className={s.sectionTitle}>{sl.monthlyActivity}</h3>
          <ActivityBars data={author.monthlyCounts} />
        </div>
      )}
    </>
  );
}
