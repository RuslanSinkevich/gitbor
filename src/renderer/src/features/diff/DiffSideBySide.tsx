import { t } from '../../i18n';
import type { DiffHunk, DiffLine } from '../../types';
import { HunkActionsOverlay } from './HunkActionsOverlay';
import s from './DiffView.module.css';

interface Props {
  hunks: DiffHunk[];
  file?: string;
  isWorkingCopy?: boolean;
  isStaged?: boolean;
}

interface SideLine {
  lineNo: number | null;
  content: string;
  type: 'add' | 'remove' | 'context' | 'empty';
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
      left.push(i < removes.length
        ? { lineNo: removes[i].oldLineNo, content: removes[i].content, type: 'remove' }
        : { lineNo: null, content: '', type: 'empty' });
      right.push(i < adds.length
        ? { lineNo: adds[i].newLineNo, content: adds[i].content, type: 'add' }
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
            className={
              line.type === 'add' || line.type === 'remove' ? highlightClass
              : line.type === 'empty' ? s.lineEmpty
              : ''
            }
          >
            <td className={s.lineNo}>{line.lineNo ?? ''}</td>
            <td className={s.lineContent}>{line.type !== 'empty' ? line.content : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DiffSideBySide({ hunks, file, isWorkingCopy, isStaged }: Props) {
  const loc = t();
  const canStage = !!file && (isWorkingCopy === true || isStaged === true);

  return (
    <div className={s.sideBySide}>
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
    </div>
  );
}
