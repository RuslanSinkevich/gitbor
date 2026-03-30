import { postCommand } from '../../api';
import type { DiffHunk } from '../../types';
import s from './DiffView.module.css';

interface Props {
  hunk: DiffHunk;
  hunkIndex: number;
  file: string;
  isWorkingCopy: boolean;
  isStaged?: boolean;
}

export function DiffHunkView({ hunk, hunkIndex, file, isWorkingCopy, isStaged }: Props) {
  const handleStageHunk = () => {
    postCommand({ type: 'stageHunk', file, hunkIndex });
  };

  const handleUnstageHunk = () => {
    postCommand({ type: 'stageHunk', file, hunkIndex, reverse: true });
  };

  return (
    <div>
      <div className={s.hunkHeader}>
        <span>{hunk.header}</span>
        {isWorkingCopy && (
          <button className={s.hunkAction} onClick={handleStageHunk} title="Stage this hunk">
            Stage Hunk
          </button>
        )}
        {isStaged && (
          <button className={s.hunkAction} onClick={handleUnstageHunk} title="Unstage this hunk">
            Unstage Hunk
          </button>
        )}
      </div>
      <table className={s.diffTable}>
        <tbody>
          {hunk.lines.map((line, i) => (
            <tr
              key={i}
              className={
                line.type === 'add' ? s.lineAdd
                : line.type === 'remove' ? s.lineRemove
                : ''
              }
            >
              <td className={s.lineNo}>{line.oldLineNo ?? ''}</td>
              <td className={s.lineNo}>{line.newLineNo ?? ''}</td>
              <td className={s.lineContent}>
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                {line.content}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
