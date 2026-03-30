import { useState } from 'react';
import type { FileDiff } from '../../types';
import { DiffHunkView } from './DiffHunkView';
import { DiffSideBySide } from './DiffSideBySide';
import s from './DiffView.module.css';

interface Props {
  diff: FileDiff;
  file: string;
  hash: string;
}

type DiffMode = 'inline' | 'side-by-side';

const STATUS_LABELS: Record<string, string> = {
  added: 'Added',
  deleted: 'Deleted',
  modified: 'Modified',
  renamed: 'Renamed',
  copied: 'Copied',
};

const STATUS_CLS: Record<string, string> = {
  added: s.statusAdded,
  deleted: s.statusDeleted,
  modified: s.statusModified,
  renamed: s.statusRenamed,
  copied: s.statusRenamed,
};

export function DiffView({ diff, file, hash }: Props) {
  const [mode, setMode] = useState<DiffMode>('inline');
  const isWorkingCopy = hash === 'WORKING';
  const isStaged = hash === 'STAGED';

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <span className={`${s.fileStatus} ${STATUS_CLS[diff.status] || ''}`}>
          {STATUS_LABELS[diff.status] || diff.status}
        </span>
        <span className={s.filePath}>
          {diff.oldPath && diff.oldPath !== diff.path
            ? `${diff.oldPath} → ${diff.path}`
            : diff.path}
        </span>
        <div className={s.modeToggle}>
          <button
            className={`${s.modeBtn} ${mode === 'inline' ? s.modeBtnActive : ''}`}
            onClick={() => setMode('inline')}
          >
            Inline
          </button>
          <button
            className={`${s.modeBtn} ${mode === 'side-by-side' ? s.modeBtnActive : ''}`}
            onClick={() => setMode('side-by-side')}
          >
            Split
          </button>
        </div>
      </div>

      {diff.isBinary ? (
        <div className={s.binary}>Binary file — diff not available</div>
      ) : diff.hunks.length === 0 ? (
        <div className={s.empty}>No changes</div>
      ) : mode === 'inline' ? (
        <div className={s.hunks}>
          {diff.hunks.map((hunk, i) => (
            <DiffHunkView key={i} hunk={hunk} hunkIndex={i} file={file} isWorkingCopy={isWorkingCopy} isStaged={isStaged} />
          ))}
        </div>
      ) : (
        <DiffSideBySide hunks={diff.hunks} file={file} isWorkingCopy={isWorkingCopy} isStaged={isStaged} />
      )}
    </div>
  );
}
