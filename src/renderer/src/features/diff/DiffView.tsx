import { useState } from 'react';
import type { FileDiff } from '../../types';
import { t } from '../../i18n';
import { DiffHunkView } from './DiffHunkView';
import { DiffSideBySide } from './DiffSideBySide';
import s from './DiffView.module.css';

interface Props {
  diff: FileDiff;
  file: string;
  hash: string;
  ignoreWs?: boolean;
  onToggleWs?: () => void;
}

type DiffMode = 'inline' | 'side-by-side';

const STATUS_CLS: Record<string, string> = {
  added: s.statusAdded,
  deleted: s.statusDeleted,
  modified: s.statusModified,
  renamed: s.statusRenamed,
  copied: s.statusRenamed,
};

export function DiffView({ diff, file, hash, ignoreWs, onToggleWs }: Props) {
  const loc = t();
  const [mode, setMode] = useState<DiffMode>('inline');
  const isWorkingCopy = hash === 'WORKING';
  const isStaged = hash === 'STAGED';
  const statusLabel =
    diff.status === 'added' ? loc.diff.statusAdded
    : diff.status === 'deleted' ? loc.diff.statusDeleted
    : diff.status === 'modified' ? loc.diff.statusModified
    : diff.status === 'renamed' ? loc.diff.statusRenamed
    : diff.status === 'copied' ? loc.diff.statusCopied
    : diff.status;

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <span className={`${s.fileStatus} ${STATUS_CLS[diff.status] || ''}`}>
          {statusLabel}
        </span>
        <span className={s.filePath}>
          {diff.oldPath && diff.oldPath !== diff.path
            ? `${diff.oldPath} → ${diff.path}`
            : diff.path}
        </span>
        {onToggleWs && (
          <button
            className={`${s.modeBtn} ${ignoreWs ? s.modeBtnActive : ''}`}
            onClick={onToggleWs}
            title={loc.diff.ignoreWhitespace}
          >
            {loc.diff.ignoreWhitespace}
          </button>
        )}
        <div className={s.modeToggle}>
          <button
            className={`${s.modeBtn} ${mode === 'inline' ? s.modeBtnActive : ''}`}
            onClick={() => setMode('inline')}
          >
            {loc.diff.inline}
          </button>
          <button
            className={`${s.modeBtn} ${mode === 'side-by-side' ? s.modeBtnActive : ''}`}
            onClick={() => setMode('side-by-side')}
          >
            {loc.diff.split}
          </button>
        </div>
      </div>

      {diff.isBinary ? (
        <div className={s.binary}>{loc.diff.binaryFile}</div>
      ) : diff.hunks.length === 0 ? (
        <div className={s.empty}>{loc.diff.noChanges}</div>
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
