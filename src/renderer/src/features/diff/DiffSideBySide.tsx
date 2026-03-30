import { postCommand } from '../../api';
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

function SideTable({ lines, label }: { lines: SideLine[]; label: string }) {
  return (
    <div className={s.sidePane}>
      <div className={s.sidePaneHeader}>{label}</div>
      <table className={s.diffTable}>
        <tbody>
          {lines.map((line, i) => (
            <tr
              key={i}
              className={
                line.type === 'add' ? s.lineAdd
                : line.type === 'remove' ? s.lineRemove
                : ''
              }
            >
              <td className={s.lineNo}>{line.lineNo ?? ''}</td>
              <td className={s.lineContent}>
                {line.type !== 'empty' ? line.content : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DiffSideBySide({ hunks, file, isWorkingCopy, isStaged }: Props) {
  const { left, right } = buildSideLines(hunks);
  return (
    <div className={s.sideBySide}>
      <div className={s.sidePane}>
        <div className={s.sidePaneHeader}>Original</div>
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
          <span>Modified</span>
          {file && (isWorkingCopy || isStaged) && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {isWorkingCopy && hunks.map((_, hi) => (
                <button key={hi} className={s.hunkAction} onClick={() => postCommand({ type: 'stageHunk', file, hunkIndex: hi })} title={`Stage hunk ${hi + 1}`}>
                  Stage {hunks.length > 1 ? `#${hi + 1}` : 'Hunk'}
                </button>
              ))}
              {isStaged && hunks.map((_, hi) => (
                <button key={hi} className={s.hunkAction} onClick={() => postCommand({ type: 'stageHunk', file, hunkIndex: hi, reverse: true })} title={`Unstage hunk ${hi + 1}`}>
                  Unstage {hunks.length > 1 ? `#${hi + 1}` : 'Hunk'}
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
