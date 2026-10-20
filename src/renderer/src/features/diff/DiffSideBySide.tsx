import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { DiffHunk, DiffLine } from '../../types';
import { HunkActionsOverlay } from './HunkActionsOverlay';
import { renderInlineDiff } from './inlineDiff';
import s from './DiffView.module.css';

interface Props {
  hunks: DiffHunk[];
  file?: string;
  isWorkingCopy?: boolean;
  isStaged?: boolean;
  /** Новый файл в рабочей копии: «Отбросить» убирает его в Корзину. */
  isNewFile?: boolean;
}

interface SideLine {
  lineNo: number | null;
  content: string;
  type: 'add' | 'remove' | 'context' | 'empty';
  pairedContent?: string;
}

/**
 * Раскладывает строки одного hunk в две колонки (left=original, right=modified).
 * Раньше функция работала сразу со всем массивом hunks и возвращала
 * сплошные ряды → нельзя было выделить границы hunk-блоков в DOM, а значит
 * и привязать к ним hover-overlay. Теперь — per-hunk, чтобы каждый блок
 * рендерился отдельным `.hunkBlock` с собственной парой колонок и actions.
 */
function buildSideLinesForHunk(hunk: DiffHunk): { left: SideLine[]; right: SideLine[] } {
  const left: SideLine[] = [];
  const right: SideLine[] = [];

  const removes: DiffLine[] = [];
  const adds: DiffLine[] = [];

  const flushPairs = () => {
    const max = Math.max(removes.length, adds.length);
    for (let i = 0; i < max; i++) {
      const remove = removes[i];
      const add = adds[i];
      left.push(i < removes.length
        ? { lineNo: remove.oldLineNo, content: remove.content, type: 'remove', pairedContent: add?.content }
        : { lineNo: null, content: '', type: 'empty' });
      right.push(i < adds.length
        ? { lineNo: add.newLineNo, content: add.content, type: 'add', pairedContent: remove?.content }
        : { lineNo: null, content: '', type: 'empty' });
    }
    removes.length = 0;
    adds.length = 0;
  };

  for (const line of hunk.lines) {
    if (line.type === 'context') {
      flushPairs();
      left.push({ lineNo: line.oldLineNo, content: line.content, type: 'context' });
      right.push({ lineNo: line.newLineNo, content: line.content, type: 'context' });
    } else if (line.type === 'remove') {
      removes.push(line);
    } else {
      adds.push(line);
    }
  }
  flushPairs();

  return { left, right };
}

interface SidePaneTableProps {
  lines: SideLine[];
  highlightClass: typeof s.lineAdd | typeof s.lineRemove;
}

function SidePaneTable({ lines, highlightClass }: SidePaneTableProps) {
  return (
    <table className={s.diffTable}>
      <tbody>
        {lines.map((line, i) => (
          <tr
            key={i}
            data-diff-mark={line.type === 'add' ? 'add' : line.type === 'remove' ? 'remove' : undefined}
            data-diff-line={line.type === 'empty' ? undefined : line.content}
            className={
              line.type === 'add' || line.type === 'remove' ? highlightClass
              : line.type === 'empty' ? s.lineEmpty
              : ''
            }
          >
            <td className={s.lineNo}>{line.lineNo ?? ''}</td>
            <td className={s.lineContent}>
              {line.type === 'add' || line.type === 'remove'
                ? renderInlineDiff(line.content, line.type, line.pairedContent)
                : line.type !== 'empty' ? line.content : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DiffSideBySide({ hunks, file, isWorkingCopy, isStaged, isNewFile }: Props) {
  const loc = t();
  const canStage = !!file && (isWorkingCopy === true || isStaged === true);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const [horizontalOverflow, setHorizontalOverflow] = useState(0);

  const syncHorizontalScroll = useCallback((left: number) => {
    if (syncingScrollRef.current) return;
    const root = rootRef.current;
    if (!root) return;
    syncingScrollRef.current = true;
    root.querySelectorAll<HTMLDivElement>(`.${s.hunkBlockSplitCol}`).forEach((el) => {
      if (el.scrollLeft !== left) el.scrollLeft = left;
    });
    if (scrollbarRef.current && scrollbarRef.current.scrollLeft !== left) {
      scrollbarRef.current.scrollLeft = left;
    }
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }, []);

  const updateHorizontalMetrics = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    let overflow = 0;
    root.querySelectorAll<HTMLDivElement>(`.${s.hunkBlockSplitCol}`).forEach((el) => {
      overflow = Math.max(overflow, el.scrollWidth - el.clientWidth);
    });
    setHorizontalOverflow(Math.max(0, overflow));
  }, []);

  useEffect(() => {
    updateHorizontalMetrics();
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateHorizontalMetrics());
    ro.observe(root);
    root.querySelectorAll<HTMLDivElement>(`.${s.hunkBlockSplitCol}`).forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [hunks, updateHorizontalMetrics]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    if (!scrollbarRef.current || horizontalOverflow <= 0) return;
    scrollbarRef.current.scrollLeft += event.deltaX;
    syncHorizontalScroll(scrollbarRef.current.scrollLeft);
  }, [horizontalOverflow, syncHorizontalScroll]);

  const scrollbarWidth = `calc(100% + ${horizontalOverflow}px)`;

  return (
    <div className={s.sideBySide} ref={rootRef} onWheel={handleWheel}>
      <div className={s.sideBySideHeader}>
        <div className={s.sidePaneHeader}>{loc.diff.original}</div>
        <div className={s.sidePaneHeader}>{loc.diff.modified}</div>
      </div>
      {hunks.map((hunk, hi) => {
        const { left, right } = buildSideLinesForHunk(hunk);
        return (
          <div key={hi} className={s.hunkBlock} tabIndex={-1}>
            <div className={s.hunkHeaderCompact}>{hunk.header}</div>
            {canStage && (
              <HunkActionsOverlay
                file={file as string}
                hunkIndex={hi}
                isWorkingCopy={isWorkingCopy === true}
                isStaged={isStaged === true}
                isNewFile={isNewFile === true}
              />
            )}
            <div className={s.hunkBlockSplit}>
              <div className={s.hunkBlockSplitCol}>
                <SidePaneTable lines={left} highlightClass={s.lineRemove} />
              </div>
              <div className={s.hunkBlockSplitCol}>
                <SidePaneTable lines={right} highlightClass={s.lineAdd} />
              </div>
            </div>
          </div>
        );
      })}
      <div
        className={`${s.splitHorizontalScrollbar} ${horizontalOverflow > 0 ? '' : s.splitHorizontalScrollbarHidden}`}
        ref={scrollbarRef}
        onScroll={(event) => syncHorizontalScroll(event.currentTarget.scrollLeft)}
      >
        <div className={s.splitHorizontalScrollbarContent} style={{ width: scrollbarWidth }} />
      </div>
    </div>
  );
}
