import { useMemo } from 'react';
import { t } from '../../i18n';
import s from './Statistics.module.css';

interface Props {
  dailyCounts: Record<string, number>;
}

function getLevel(count: number, max: number): number {
  if (count === 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function ContributionHeatmap({ dailyCounts }: Props) {
  const loc = t();
  const sl = loc.stats;

  const { weeks, dayLabels } = useMemo(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();

    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + (6 - dayOfWeek));

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 52 * 7 + 1);

    const allDays: { date: string; count: number }[] = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const key = cursor.toISOString().slice(0, 10);
      allDays.push({ date: key, count: dailyCounts[key] || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    const maxCount = Math.max(...allDays.map(d => d.count), 1);

    const weekCols: { date: string; count: number; level: number }[][] = [];
    for (let i = 0; i < allDays.length; i += 7) {
      weekCols.push(
        allDays.slice(i, i + 7).map(d => ({
          ...d,
          level: getLevel(d.count, maxCount),
        })),
      );
    }

    const shortDays = [sl.sun, sl.mon, sl.tue, sl.wed, sl.thu, sl.fri, sl.sat];
    const dayLbls = [shortDays[1], shortDays[3], shortDays[5]];

    const months: { label: string; col: number }[] = [];
    let lastMonth = '';
    for (let w = 0; w < weekCols.length; w++) {
      const firstDay = weekCols[w][0];
      if (!firstDay) continue;
      const m = firstDay.date.slice(0, 7);
      if (m !== lastMonth) {
        months.push({ label: m, col: w });
        lastMonth = m;
      }
    }

    return { weeks: weekCols, dayLabels: dayLbls, monthLabels: months };
  }, [dailyCounts, sl]);

  return (
    <div>
      <div className={s.heatmapRow}>
        <div className={s.heatmapDayLabels}>
          {dayLabels.map((d, i) => (
            <span key={i} className={s.heatmapDayLabel}>{d}</span>
          ))}
        </div>
        <div className={s.heatmapGrid}>
          {weeks.map((week, wi) => (
            <div key={wi} className={s.heatmapWeek}>
              {week.map((day, di) => (
                <div
                  key={di}
                  className={s.heatmapCell}
                  data-level={day.level}
                  title={`${day.date}: ${day.count}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className={s.heatmapLegend}>
        <span>{sl.less}</span>
        {[0, 1, 2, 3, 4].map(level => (
          <div key={level} className={s.heatmapCell} data-level={level} />
        ))}
        <span>{sl.more}</span>
      </div>
    </div>
  );
}
