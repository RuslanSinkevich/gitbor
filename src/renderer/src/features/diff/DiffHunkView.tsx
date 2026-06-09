import type { DiffHunk } from '../../types';
import { HunkActionsOverlay } from './HunkActionsOverlay';
import { renderInlineDiff } from './inlineDiff';
import s from './DiffView.module.css';

interface Props {
  hunk: DiffHunk;
  hunkIndex: number;
  file: string;
  isWorkingCopy: boolean;
  isStaged?: boolean;
}

/**
 * Inline-режим: один hunk = `.hunkBlock` с компактным header и hover-overlay
 * Stage/Discard/Unstage. Header `@@ -52,8 +52,9 @@ …` остаётся видимым
 * как ориентир в потоке, но без фона и sticky — diff читается ближе к
 * чистому коду (Fork-style).
 */
export function DiffHunkView({ hunk, hunkIndex, file, isWorkingCopy, isStaged }: Props) {
  const pairedContent = new Map<number, string>();
  const removes: number[] = [];
  const adds: number[] = [];
  const flushPairs = () => {
    const max = Math.min(removes.length, adds.length);
    for (let i = 0; i < max; i++) {
      const removeIndex = removes[i];
      const addIndex = adds[i];
      pairedContent.set(removeIndex, hunk.lines[addIndex].content);
      pairedContent.set(addIndex, hunk.lines[removeIndex].content);
    }
    removes.length = 0;
    adds.length = 0;
  };

  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    if (line.type === 'context') {
      flushPairs();
    } else if (line.type === 'remove') {
      removes.push(i);
    } else {
      adds.push(i);
    }
  }
  flushPairs();

  return (
    <div className={s.hunkBlock} tabIndex={-1}>
      <div className={s.hunkHeaderCompact}>{hunk.header}</div>
      <HunkActionsOverlay
        file={file}
        hunkIndex={hunkIndex}
        isWorkingCopy={isWorkingCopy}
        isStaged={isStaged === true}
      />
      <table className={s.diffTable}>
        <tbody>
          {hunk.lines.map((line, i) => (
            <tr
              key={i}
              data-diff-mark={line.type === 'add' ? 'add' : line.type === 'remove' ? 'remove' : undefined}
              data-diff-line={line.content}
              className={
                line.type === 'add' ? s.lineAdd
                : line.type === 'remove' ? s.lineRemove
                : ''
              }
            >
              <td className={s.lineNo}>{line.oldLineNo ?? ''}</td>
              <td className={s.lineNo}>{line.newLineNo ?? ''}</td>
              {/* Префикс +/- убран — расцветка фоном (lineAdd/lineRemove)
                  уже однозначно показывает тип строки, дублирующий символ
                  отвлекает и съедает горизонтальное пространство. */}
              <td className={s.lineContent}>
                {line.type === 'add' || line.type === 'remove'
                  ? renderInlineDiff(line.content, line.type, pairedContent.get(i))
                  : line.content}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
