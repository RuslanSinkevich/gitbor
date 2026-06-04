import { useMemo, useRef, useState, useCallback, useEffect, type RefObject } from 'react';
import { t } from '../../i18n';
import type { DiffHunk } from '../../types';
import { buildSideRows, buildChangeMarks, type SideCell } from './diffRows';
import { DiffMinimap } from './DiffMinimap';
import s from './DiffView.module.css';

interface Props {
  hunks: DiffHunk[];
}

const ROW_HEIGHT = 20;
const OVERSCAN = 20;
/** Запас под номер строки (50px) + паддинги контента, в px. */
const GUTTER_PX = 74;

function cellClass(cell: SideCell): string {
  if (cell.type === 'add') return s.lineAdd;
  if (cell.type === 'remove') return s.lineRemove;
  // Пустая ячейка-«заполнитель» парности (на этой стороне строки нет) —
  // помечаем штриховкой, чтобы было видно, где вставка/удаление на другой стороне.
  if (cell.type === 'empty') return s.lineEmpty;
  return '';
}

/** Максимальная длина строки контента отдельно по каждой стороне (для ширины дорожки). */
function sideMaxLen(rows: { left: SideCell; right: SideCell }[]): { left: number; right: number } {
  let l = 0, r = 0;
  for (const row of rows) {
    if (row.left.content.length > l) l = row.left.content.length;
    if (row.right.content.length > r) r = row.right.content.length;
  }
  return { left: l, right: r };
}

/**
 * Whole-file side-by-side: весь файл целиком в две колонки (как VS Git History /
 * Fork). Строки виртуализированы — в DOM живут только видимые + overscan, поэтому
 * файлы на десятки тысяч строк скроллятся без фриза.
 *
 * Каждая панель (оригинал/изменённый) — отдельный скроллер: вертикаль
 * синхронизируется между панелями (и миникартой), а горизонталь у каждой своя
 * (длинные строки видно целиком, не ломая авто-середину 50/50). Нативные
 * вертикальные скроллбары спрятаны — позицию показывает overview-ruler справа.
 */
export function DiffWholeFile({ hunks }: Props) {
  const loc = t();
  const rows = useMemo(() => buildSideRows(hunks), [hunks]);
  const marks = useMemo(() => buildChangeMarks(rows), [rows]);
  const { left: leftLen, right: rightLen } = useMemo(() => sideMaxLen(rows), [rows]);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 60 });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  const applyMetrics = useCallback((top: number, client: number) => {
    const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(rows.length, Math.ceil((top + client) / ROW_HEIGHT) + OVERSCAN);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    setScrollTop(top);
    setViewport(client);
  }, [rows.length]);

  /* Синхронизация вертикали: при скролле одной панели подтягиваем вторую.
     Установка scrollTop вызовет ещё одно событие scroll на второй панели, но
     там значения уже равны → повторной установки нет, цикл гасится сам. */
  const onPaneScroll = useCallback((src: 'left' | 'right') => {
    const a = (src === 'left' ? leftRef : rightRef).current;
    const b = (src === 'left' ? rightRef : leftRef).current;
    if (!a) return;
    if (b && b.scrollTop !== a.scrollTop) b.scrollTop = a.scrollTop;
    applyMetrics(a.scrollTop, a.clientHeight);
  }, [applyMetrics]);

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left) return;
    applyMetrics(left.scrollTop, left.clientHeight);
    const onLeft = () => onPaneScroll('left');
    const onRight = () => onPaneScroll('right');
    left.addEventListener('scroll', onLeft, { passive: true });
    right?.addEventListener('scroll', onRight, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => applyMetrics(left.scrollTop, left.clientHeight))
      : null;
    ro?.observe(left);
    return () => {
      left.removeEventListener('scroll', onLeft);
      right?.removeEventListener('scroll', onRight);
      ro?.disconnect();
    };
  }, [onPaneScroll, applyMetrics]);

  const totalHeight = rows.length * ROW_HEIGHT;
  const visible = rows.slice(range.start, range.end);
  const leftWidth = `max(100%, calc(${leftLen}ch + ${GUTTER_PX}px))`;
  const rightWidth = `max(100%, calc(${rightLen}ch + ${GUTTER_PX}px))`;

  const onSeek = useCallback((ratioTop: number) => {
    const a = leftRef.current;
    if (!a) return;
    const max = Math.max(0, totalHeight - a.clientHeight);
    // Центрируем вьюпорт на точке клика, а не ставим её в самый верх.
    const target = Math.min(max, Math.max(0, ratioTop * totalHeight - a.clientHeight / 2));
    if (leftRef.current) leftRef.current.scrollTop = target;
    if (rightRef.current) rightRef.current.scrollTop = target;
  }, [totalHeight]);

  const renderLane = (side: 'left' | 'right', ref: RefObject<HTMLDivElement>, width: string) => (
    <div className={s.wholePane} ref={ref}>
      <div className={s.wholeLane} style={{ height: totalHeight, width }}>
        {visible.map((row, i) => {
          const rowIndex = range.start + i;
          const cell = side === 'left' ? row.left : row.right;
          return (
            <div
              key={rowIndex}
              className={`${s.wholeLaneRow} ${cellClass(cell)}`}
              data-diff-line={cell.type === 'empty' ? undefined : cell.content}
              style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <span className={s.wholeLineNo}>{cell.lineNo ?? ''}</span>
              <span className={s.wholeContent}>{cell.type !== 'empty' ? cell.content : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={s.wholeRoot}>
      <div className={s.wholeHeaderRow}>
        <div className={s.sideBySideHeader}>
          <div className={s.sidePaneHeader}>{loc.diff.original}</div>
          <div className={s.sidePaneHeader}>{loc.diff.modified}</div>
        </div>
        <div className={s.minimapSpacer} />
      </div>
      <div className={s.wholeWrap}>
        <div className={s.wholePanes}>
          {renderLane('left', leftRef, leftWidth)}
          {renderLane('right', rightRef, rightWidth)}
        </div>
        <DiffMinimap marks={marks} scrollTop={scrollTop} viewport={viewport} content={totalHeight} onSeek={onSeek} />
      </div>
    </div>
  );
}
