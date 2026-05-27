import type { DiffHunk } from '../../types';
import { HunkActionsOverlay } from './HunkActionsOverlay';
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
              <td className={s.lineContent}>{line.content}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
