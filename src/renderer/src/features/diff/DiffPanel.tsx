import { useEffect, useState, useRef, useCallback } from 'react';
import type { FileDiff } from '../../types';
import { t } from '../../i18n';
import { postCommand, onMainEvent, isElectron } from '../../api';
import { DiffView, type DiffMode } from './DiffView';
import { ImageDiff, isImageFile } from './ImageDiff';
import s from './DiffView.module.css';

interface Props {
  file: string;
  hash: string;
}

const DIFF_TIMEOUT_MS = 15_000;

const MODE_KEY_RO = 'sg-diff-mode-ro';
const MODE_KEY_RW = 'sg-diff-mode-rw';

/** Read-only diff: коммит, диапазон `a..b`, PREV: — всё кроме рабочей копии. */
function isReadOnlyHash(hash: string): boolean {
  return hash !== 'WORKING' && hash !== 'STAGED';
}

function loadMode(readOnly: boolean): DiffMode {
  const stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem(readOnly ? MODE_KEY_RO : MODE_KEY_RW)
    : null;
  if (stored === 'inline' || stored === 'split' || stored === 'whole') return stored;
  // Для просмотра коммита/сравнения дефолт — весь файл (как VS Git History);
  // для рабочей копии — hunk-вид, чтобы были stage/discard действия.
  return readOnly ? 'whole' : 'inline';
}

export function DiffPanel({ file, hash }: Props) {
  const loc = t();
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ignoreWs, setIgnoreWs] = useState(false);
  const requestRef = useRef({ file, hash });

  const readOnly = isReadOnlyHash(hash);
  const [mode, setMode] = useState<DiffMode>(() => loadMode(readOnly));
  // При переходе read-only ↔ editable (например, файл коммита → рабочая копия)
  // возвращаем дефолт/сохранённый режим для нового контекста.
  useEffect(() => { setMode(loadMode(readOnly)); }, [readOnly]);

  const handleModeChange = useCallback((next: DiffMode) => {
    setMode(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(readOnly ? MODE_KEY_RO : MODE_KEY_RW, next);
    }
  }, [readOnly]);

  const needsFullContext = mode === 'whole';
  const isImage = isImageFile(file);

  useEffect(() => {
    if (isImage) {
      setLoading(false);
      return;
    }

    if (!isElectron) {
      setLoading(false);
      setError(loc.diff.ipcUnavailable);
      return;
    }

    setLoading(true);
    setDiffs(null);
    setError(null);
    requestRef.current = { file, hash };
    postCommand({ type: 'getFileDiff', file, hash, ignoreWhitespace: ignoreWs || undefined, fullContext: needsFullContext || undefined });

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'fileDiff') {
        const isMatch = msg.file === file && msg.hash === hash;
        if (isMatch) {
          setDiffs(msg.data);
          setLoading(false);
        }
      }
    });

    const timeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) setError(loc.diff.requestTimedOut);
        return false;
      });
    }, DIFF_TIMEOUT_MS);

    return () => { unsub(); clearTimeout(timeout); };
  }, [file, hash, isImage, ignoreWs, loc, needsFullContext]);

  const handleToggleWs = useCallback(() => {
    setIgnoreWs(prev => !prev);
  }, []);

  if (isImage) {
    return <ImageDiff file={file} hash={hash} />;
  }

  if (loading) {
    return <div className={s.empty}>{loc.diff.loading}</div>;
  }

  if (error) {
    return <div className={s.empty}>{error}</div>;
  }

  if (!diffs || diffs.length === 0) {
    return <div className={s.empty}>{loc.diff.noDiff}</div>;
  }

  const firstDiff = diffs[0];
  if (firstDiff?.statDirty) {
    return (
      <div className={s.empty} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center', alignItems: 'center' }}>
        <div style={{ fontWeight: 600 }}>{loc.diff.statDirtyTitle}</div>
        <div style={{ opacity: 0.7, maxWidth: 420 }}>{loc.diff.statDirtyHint}</div>
        <button
          className="sg-button sg-button--md sg-button--primary"
          onClick={() => postCommand({ type: 'restoreStatDirty', file })}
        >
          {loc.diff.statDirtyRefresh}
        </button>
      </div>
    );
  }

  return (
    <>
      {diffs.map((d, i) => (
        <DiffView key={`${d.path}-${i}`} diff={d} file={file} hash={hash}
          ignoreWs={ignoreWs} onToggleWs={handleToggleWs}
          mode={mode} onModeChange={handleModeChange}
        />
      ))}
    </>
  );
}
