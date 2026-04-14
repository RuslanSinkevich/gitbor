import type { MonthlyCount } from '../../types';
import s from './Statistics.module.css';

interface Props {
  data: MonthlyCount[];
  height?: number;
}

export function ActivityBars({ data, height = 80 }: Props) {
  if (data.length === 0) return null;

  const max = Math.max(...data.map(d => d.count), 1);

  const firstLabel = data[0].month;
  const lastLabel = data[data.length - 1].month;

  return (
    <div>
      <div className={s.barsContainer} style={{ height }}>
        {data.map((d) => (
          <div
            key={d.month}
            className={s.bar}
            style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }}
          >
            <span className={s.barTooltip}>{d.month}: {d.count}</span>
          </div>
        ))}
      </div>
      <div className={s.barsLabels}>
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>
    </div>
  );
}
