import { t } from '../../i18n';
import type { AuthorStats, AuthorCodeStatsResult } from '../../types';
import { ContributionHeatmap } from './ContributionHeatmap';
import { ActivityBars } from './ActivityBars';
import { computeAuthorInsights } from './authorInsights';
import s from './Statistics.module.css';

interface Props {
  author: AuthorStats;
  codeStats: AuthorCodeStatsResult | null;
  codeStatsLoading: boolean;
  onCalculateCodeStats: (force?: boolean) => void;
}

export function AuthorDetailView({ author, codeStats, codeStatsLoading, onCalculateCodeStats }: Props) {
  const loc = t();
  const sl = loc.stats;
  const stats = codeStats?.stats;
  const dash = '—';
  const insights = computeAuthorInsights(author.dailyCounts);
  const weekdayLabels = [sl.mon, sl.tue, sl.wed, sl.thu, sl.fri, sl.sat, sl.sun];
  const maxWeekday = Math.max(1, ...insights.weekdayCounts);
  const lastCalculated = stats
    ? new Date(stats.calculatedAt).toLocaleString()
    : sl.notCalculated;

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
        <div className={s.metricCard}>
          <div className={s.metricValue}>{author.firstDate}</div>
          <div className={s.metricLabel}>{sl.firstCommit}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricValue}>{author.lastDate}</div>
          <div className={s.metricLabel}>{sl.lastCommit}</div>
        </div>
      </div>

      <div className={s.insightsSection}>
        <h3 className={s.sectionTitle}>{sl.insights}</h3>
        <div className={s.metricsRow}>
          <div className={s.metricCard}>
            <div className={s.metricValue}>{insights.activeDays.toLocaleString()}</div>
            <div className={s.metricLabel}>{sl.activeDays}</div>
          </div>
          <div className={s.metricCard}>
            <div className={s.metricValue}>{insights.longestStreak} {sl.streakDays}</div>
            <div className={s.metricLabel}>{sl.longestStreak}</div>
          </div>
          <div className={s.metricCard}>
            <div className={s.metricValue}>{insights.currentStreak} {sl.streakDays}</div>
            <div className={s.metricLabel}>{sl.currentStreak}</div>
          </div>
          <div className={s.metricCard}>
            <div className={s.metricValue}>{insights.avgPerActiveDay}</div>
            <div className={s.metricLabel}>{sl.avgPerActiveDay}</div>
          </div>
        </div>
        <div className={s.weekdayChart}>
          <div className={s.weekdayChartTitle}>{sl.weekdayActivity}</div>
          <div className={s.weekdayBars}>
            {insights.weekdayCounts.map((count, i) => (
              <div key={i} className={s.weekdayCol} title={`${weekdayLabels[i]}: ${count}`}>
                <div className={s.weekdayBarTrack}>
                  <div
                    className={s.weekdayBarFill}
                    style={{ height: `${(count / maxWeekday) * 100}%` }}
                  />
                </div>
                <div className={s.weekdayLabel}>{weekdayLabels[i]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {author.monthlyCounts.length > 0 && (
        <div className={s.barsSection}>
          <h3 className={s.sectionTitle}>{sl.monthlyActivity}</h3>
          <ActivityBars data={author.monthlyCounts} />
        </div>
      )}

      <div className={s.heatmapSection}>
        <h3 className={s.sectionTitle}>{sl.heatmap}</h3>
        <ContributionHeatmap dailyCounts={author.dailyCounts} authorName={author.name} />
      </div>

      <div className={s.codeStatsSection}>
        <div className={s.codeStatsHeader}>
          <h3 className={s.sectionTitle}>{sl.codeStats}</h3>
          <button
            className={s.btnSecondary}
            onClick={() => onCalculateCodeStats(!!stats)}
            disabled={codeStatsLoading}
          >
            {codeStatsLoading && <span className={s.inlineSpinner} aria-hidden="true" />}
            {codeStatsLoading ? sl.loadingCodeStats : stats ? sl.recalculateCodeStats : sl.calculateCodeStats}
          </button>
        </div>
        <div className={s.codeStatsList}>
          <div className={s.codeStatsRow}>
            <span className={s.codeStatsName}>{sl.changedLines}</span>
            <span className={s.codeStatsDots} aria-hidden="true" />
            <span className={s.codeStatsValue}>
              {stats ? `+${stats.addedLines.toLocaleString()} / -${stats.deletedLines.toLocaleString()}` : dash}
            </span>
          </div>
          <div className={s.codeStatsRow}>
            <span className={s.codeStatsName}>{sl.addedLines}</span>
            <span className={s.codeStatsDots} aria-hidden="true" />
            <span className={s.codeStatsValue}>{stats ? `+${stats.addedLines.toLocaleString()}` : dash}</span>
          </div>
          <div className={s.codeStatsRow}>
            <span className={s.codeStatsName}>{sl.deletedLines}</span>
            <span className={s.codeStatsDots} aria-hidden="true" />
            <span className={s.codeStatsValue}>{stats ? `-${stats.deletedLines.toLocaleString()}` : dash}</span>
          </div>
          <div className={s.codeStatsRow}>
            <span className={s.codeStatsName}>{sl.netLines}</span>
            <span className={s.codeStatsDots} aria-hidden="true" />
            <span className={s.codeStatsValue}>{stats ? stats.netLines.toLocaleString() : dash}</span>
          </div>
          <div className={s.codeStatsRow}>
            <span className={s.codeStatsName}>{sl.touchedFiles}</span>
            <span className={s.codeStatsDots} aria-hidden="true" />
            <span className={s.codeStatsValue}>{stats ? stats.touchedFiles.toLocaleString() : dash}</span>
          </div>
          <div className={s.codeStatsRow}>
            <span className={s.codeStatsName}>{sl.binaryFiles}</span>
            <span className={s.codeStatsDots} aria-hidden="true" />
            <span className={s.codeStatsValue}>{stats ? stats.binaryFiles.toLocaleString() : dash}</span>
          </div>
          <div className={s.codeStatsRow}>
            <span className={s.codeStatsName}>{sl.lastCalculated}</span>
            <span className={s.codeStatsDots} aria-hidden="true" />
            <span className={s.codeStatsStatus}>
              {codeStatsLoading && <span className={s.inlineSpinner} aria-hidden="true" />}
              <span className={s.codeStatsValue}>
                {codeStatsLoading ? sl.loadingCodeStats : lastCalculated}
              </span>
              {!codeStatsLoading && codeStats?.fromCache && stats ? ` (${sl.fromCache})` : ''}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
