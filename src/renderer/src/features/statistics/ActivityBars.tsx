import { useState } from 'react';
import type { MonthlyCount } from '../../types';
import s from './Statistics.module.css';

interface Props {
  data: MonthlyCount[];
  height?: number;
}

export function ActivityBars({ data, height = 80 }: Props) {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  if (data.length === 0) return null;

  const max = Math.max(...data.map(d => d.count), 1);
  const maxVisibleLabels = 10;
  const labelStep = Math.max(1, Math.ceil(data.length / maxVisibleLabels));
  const lastIndex = data.length - 1;

  return (
    <div>
      <div className={s.barsContainer} style={{ height }}>
        {data.map((d) => (
          <div
            key={d.month}
            className={s.bar}
            style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }}
            onMouseEnter={(e) => setTooltip({ text: `${d.month}: ${d.count}`, x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => setTooltip({ text: `${d.month}: ${d.count}`, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
      </div>
      <div className={s.barsLabels}>
        {data.map((d, index) => {
          const showLabel = index === 0 || index === lastIndex || index % labelStep === 0;
          if (!showLabel) return null;

          const positionPercent = lastIndex === 0 ? 0 : (index / lastIndex) * 100;
          const edgeClassName = index === 0
            ? s.barsLabelStart
            : index === lastIndex
              ? s.barsLabelEnd
              : s.barsLabelCenter;

          return (
            <span
              key={d.month}
              className={`${s.barsLabel} ${edgeClassName}`}
              style={{ left: `${positionPercent}%` }}
              title={d.month}
            >
              {d.month}
            </span>
          );
        })}
      </div>
      {tooltip && (
        <div className={s.fixedTooltip} style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
