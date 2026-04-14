import { useMemo, useState, useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { postCommand, onMainEvent } from '../../api';
import type { DayCommitEntry } from '../../types';
import s from './Statistics.module.css';

interface Props {
  dailyCounts: Record<string, number>;
  authorName: string;
}

function getLevel(count: number, max: number): number {
  if (count === 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function ContributionHeatmap({ dailyCounts, authorName }: Props) {
  const loc = t();
  const sl = loc.stats;
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayCommits, setDayCommits] = useState<DayCommitEntry[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const pendingDayRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'dayCommits' && pendingDayRef.current) {
        setDayCommits(msg.data);
        setLoadingDay(false);
        pendingDayRef.current = null;
      }
    });
    return unsub;
  }, []);

  const fetchDay = (date: string) => {
    pendingDayRef.current = date;
    setLoadingDay(true);
    setDayCommits([]);
    postCommand({ type: 'getDayCommits', author: authorName, date });
  };

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

    return { weeks: weekCols, dayLabels: dayLbls };
  }, [dailyCounts, sl]);

  const handleCellClick = (date: string, count: number) => {
    if (count === 0) return;
    if (selectedDay === date) {
      setSelectedDay(null);
      setDayCommits([]);
      setLoadingDay(false);
    } else {
      setSelectedDay(date);
      fetchDay(date);
    }
  };

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
                  className={`${s.heatmapCell} ${day.count > 0 ? s.heatmapCellClickable : ''} ${selectedDay === day.date ? s.heatmapCellSelected : ''}`}
                  data-level={day.level}
                  title={`${day.date}: ${day.count}`}
                  onClick={() => handleCellClick(day.date, day.count)}
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

      {selectedDay && (
        <div className={s.dayPopup}>
          <div className={s.dayPopupHeader}>
            <strong>{selectedDay}</strong>
            <span className={s.dayPopupCount}>{dailyCounts[selectedDay] || 0} {sl.commitsOnDay}</span>
            <button className={s.dayPopupClose} onClick={() => { setSelectedDay(null); setDayCommits([]); setLoadingDay(false); }}>✕</button>
          </div>
          {loadingDay && <div className={s.dayPopupLoading}>{loc.app.loading}</div>}
          {!loadingDay && dayCommits.length > 0 && (
            <ul className={s.dayCommitList}>
              {dayCommits.map(c => (
                <li key={c.hash} className={s.dayCommitItem}>
                  <span className={s.dayCommitHash}>{c.hash.slice(0, 7)}</span>
                  <span className={s.dayCommitSubject}>{c.subject}</span>
                </li>
              ))}
            </ul>
          )}
          {!loadingDay && dayCommits.length === 0 && (
            <div className={s.dayPopupLoading}>{sl.noData}</div>
          )}
        </div>
      )}
    </div>
  );
}
