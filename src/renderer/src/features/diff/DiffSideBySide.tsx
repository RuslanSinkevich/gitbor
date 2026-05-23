import { postCommand } from '../../api';
import { t } from '../../i18n';
import type { DiffHunk, DiffLine } from '../../types';
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

function buildSideLines(hunks: DiffHunk[]): { left: SideLine[]; right: SideLine[] } {
  const left: SideLine[] = [];
  const right: SideLine[] = [];

  for (const hunk of hunks) {
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
  }

  return { left, right };
}

export function DiffSideBySide({ hunks, file, isWorkingCopy, isStaged }: Props) {
  const loc = t();
  const { left, right } = buildSideLines(hunks);
  return (
    <div className={s.sideBySide}>
      <div className={s.sidePane}>
        <div className={s.sidePaneHeader}>{loc.diff.original}</div>
        <table className={s.diffTable}>
          <tbody>
            {left.map((line, i) => (
              <tr key={i} className={line.type === 'remove' ? s.lineRemove : ''}>
                <td className={s.lineNo}>{line.lineNo ?? ''}</td>
                <td className={s.lineContent}>{line.type !== 'empty' ? line.content : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={s.sidePane}>
        <div className={s.sidePaneHeader}>
          <span>{loc.diff.modified}</span>
          {file && (isWorkingCopy || isStaged) && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {isWorkingCopy && hunks.map((_, hi) => (
                <span key={`stage-${hi}`} style={{ display: 'inline-flex', gap: 4 }}>
                  <button className={s.hunkAction} onClick={() => postCommand({ type: 'stageHunk', file, hunkIndex: hi })} title={`${loc.diff.stageHunk} ${hi + 1}`}>
                    {hunks.length > 1 ? `${loc.diff.stageHunk} #${hi + 1}` : loc.diff.stageHunk}
                  </button>
                  <button
                    className={`${s.hunkAction} ${s.hunkActionDanger}`}
                    onClick={() => {
                      if (!window.confirm(`${loc.diff.discardHunkTitle}\n\n${loc.diff.discardHunkMessage}`)) return;
                      postCommand({ type: 'discardHunk', file, hunkIndex: hi });
                    }}
                    title={`${loc.diff.discardHunk} ${hi + 1}`}
                  >
                    {hunks.length > 1 ? `${loc.diff.discardHunk} #${hi + 1}` : loc.diff.discardHunk}
                  </button>
                </span>
              ))}
              {isStaged && hunks.map((_, hi) => (
                <button key={`unstage-${hi}`} className={s.hunkAction} onClick={() => postCommand({ type: 'stageHunk', file, hunkIndex: hi, reverse: true })} title={`${loc.diff.unstageHunk} ${hi + 1}`}>
                  {hunks.length > 1 ? `${loc.diff.unstageHunk} #${hi + 1}` : loc.diff.unstageHunk}
                </button>
              ))}
            </span>
          )}
        </div>
        <table className={s.diffTable}>
          <tbody>
            {right.map((line, i) => (
              <tr key={i} className={line.type === 'add' ? s.lineAdd : ''}>
                <td className={s.lineNo}>{line.lineNo ?? ''}</td>
                <td className={s.lineContent}>{line.type !== 'empty' ? line.content : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
