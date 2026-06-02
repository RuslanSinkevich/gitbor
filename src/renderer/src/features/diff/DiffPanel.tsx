import { useEffect, useState, useCallback } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import { DiffView, type DiffMode } from './DiffView';
import { ImageDiff, isImageFile } from './ImageDiff';
import { useFileDiff } from './useFileDiff';
import s from './DiffView.module.css';

interface Props {
  file: string;
  hash: string;
  /** Открыть текущий файл в полноэкранной модалке сравнения. */
  onExpand?: (file: string, hash: string) => void;
}

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
  // Дефолт везде — inline (unified): и для коммита/сравнения, и для рабочей
  // копии. Сохранённый выбор пользователя (localStorage) приоритетнее.
  return 'inline';
}

export function DiffPanel({ file, hash, onExpand }: Props) {
  const loc = t();
  const [ignoreWs, setIgnoreWs] = useState(false);

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

  const isImage = isImageFile(file);
  const needsFullContext = mode === 'whole';
  const { diffs, loading, error } = useFileDiff(file, hash, ignoreWs, needsFullContext, !isImage);

  const handleToggleWs = useCallback(() => {
    setIgnoreWs((prev) => !prev);
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
          onExpand={onExpand ? () => onExpand(file, hash) : undefined}
        />
      ))}
    </>
  );
}
