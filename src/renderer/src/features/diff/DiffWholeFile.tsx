import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { t } from '../../i18n';
import type { DiffHunk } from '../../types';
import { buildSideRows, maxRowContentLength, type SideCell } from './diffRows';
import s from './DiffView.module.css';

interface Props {
  hunks: DiffHunk[];
}

const ROW_HEIGHT = 20;
const OVERSCAN = 20;
/** Запас по ширине колонки на нумерацию строк + паддинги (в ch). */
const COL_GUTTER_CH = 12;

function cellClass(cell: SideCell): string {
  if (cell.type === 'add') return s.lineAdd;
  if (cell.type === 'remove') return s.lineRemove;
  return '';
}

/**
 * Whole-file side-by-side: весь файл целиком в две колонки (как VS Git History).
 * Строки виртуализированы — в DOM живут только видимые + overscan, поэтому
 * файлы на десятки тысяч строк скроллятся без фриза. Единый scroll-контейнер
 * с парными рядами гарантирует вертикальное выравнивание колонок без
 * синхронизации двух скроллов.
 */
export function DiffWholeFile({ hunks }: Props) {
  const loc = t();
  const rows = useMemo(() => buildSideRows(hunks), [hunks]);
  const colCh = useMemo(() => maxRowContentLength(rows) + COL_GUTTER_CH, [rows]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 60 });

  const updateRange = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const start = Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(rows.length, Math.ceil((el.scrollTop + el.clientHeight) / ROW_HEIGHT) + OVERSCAN);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [rows.length]);

  useEffect(() => {
    updateRange();
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateRange, { passive: true });
    return () => el.removeEventListener('scroll', updateRange);
  }, [updateRange]);

  const totalHeight = rows.length * ROW_HEIGHT;
  const visible = rows.slice(range.start, range.end);
  // Колонки фиксированной ширины (по самой длинной строке) → горизонтальный
  // скролл общий на весь файл, а не дёргается per-row при виртуализации.
  const innerWidth = `max(100%, ${colCh * 2}ch)`;

  return (
    <div className={s.wholeFile} ref={containerRef}>
      <div className={s.wholeInner} style={{ width: innerWidth }}>
        <div className={s.sideBySideHeader}>
          <div className={s.sidePaneHeader}>{loc.diff.original}</div>
          <div className={s.sidePaneHeader}>{loc.diff.modified}</div>
        </div>
        <div className={s.wholeViewport} style={{ height: totalHeight }}>
          {visible.map((row, i) => {
            const rowIndex = range.start + i;
            return (
              <div
                key={rowIndex}
                className={s.wholeRow}
                style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
              >
                <div className={`${s.wholeCell} ${cellClass(row.left)}`}>
                  <span className={s.wholeLineNo}>{row.left.lineNo ?? ''}</span>
                  <span className={s.wholeContent}>{row.left.type !== 'empty' ? row.left.content : ''}</span>
                </div>
                <div className={`${s.wholeCell} ${cellClass(row.right)}`}>
                  <span className={s.wholeLineNo}>{row.right.lineNo ?? ''}</span>
                  <span className={s.wholeContent}>{row.right.type !== 'empty' ? row.right.content : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
