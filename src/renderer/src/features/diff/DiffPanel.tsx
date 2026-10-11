import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import { DiffView, type DiffLayout } from './DiffView';
import { ImageDiff, isImageFile } from './ImageDiff';
import type { MarkdownPreviewTarget } from './MarkdownPreviewModal';
import { useFileDiff } from './useFileDiff';
import s from './DiffView.module.css';

// Markdown-preview модалка тянет за собой UI Markdown-парсер; нужна только
// при просмотре .md-файлов и редко. Lazy — чтобы не вздуть главный бандл.
const MarkdownPreviewModal = lazy(() => import('./MarkdownPreviewModal').then(m => ({ default: m.MarkdownPreviewModal })));

function isMarkdownFile(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

interface Props {
  file: string;
  hash: string;
  /** Открыть текущий файл в полноэкранной модалке сравнения. */
  onExpand?: (file: string, hash: string) => void;
}

const MODE_KEY_RO = 'sg-diff-mode-ro';
const MODE_KEY_RW = 'sg-diff-mode-rw';
const WHOLE_KEY_RO = 'sg-diff-whole-ro';
const WHOLE_KEY_RW = 'sg-diff-whole-rw';

/** Read-only diff: коммит, диапазон `a..b`, PREV: — всё кроме рабочей копии. */
function isReadOnlyHash(hash: string): boolean {
  return hash !== 'WORKING' && hash !== 'STAGED';
}

interface ViewPrefs {
  layout: DiffLayout;
  wholeFile: boolean;
}

function loadPrefs(readOnly: boolean): ViewPrefs {
  if (typeof localStorage === 'undefined') return { layout: 'inline', wholeFile: false };
  const stored = localStorage.getItem(readOnly ? MODE_KEY_RO : MODE_KEY_RW);
  const whole = localStorage.getItem(readOnly ? WHOLE_KEY_RO : WHOLE_KEY_RW);
  // Миграция: раньше «весь файл» был третьим режимом рядом с inline/split и
  // всегда рисовался в две колонки — сохраняем пользователю тот же вид.
  if (stored === 'whole') return { layout: 'split', wholeFile: whole !== '0' };
  // Дефолт везде — inline (unified) без полного файла: и для коммита/сравнения,
  // и для рабочей копии. Сохранённый выбор пользователя приоритетнее.
  return {
    layout: stored === 'split' ? 'split' : 'inline',
    wholeFile: whole === '1',
  };
}

function savePrefs(readOnly: boolean, prefs: ViewPrefs): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(readOnly ? MODE_KEY_RO : MODE_KEY_RW, prefs.layout);
  localStorage.setItem(readOnly ? WHOLE_KEY_RO : WHOLE_KEY_RW, prefs.wholeFile ? '1' : '0');
}

export function DiffPanel({ file, hash, onExpand }: Props) {
  const loc = t();
  const [ignoreWs, setIgnoreWs] = useState(false);

  const readOnly = isReadOnlyHash(hash);
  const [prefs, setPrefs] = useState<ViewPrefs>(() => loadPrefs(readOnly));
  // При переходе read-only ↔ editable (например, файл коммита → рабочая копия)
  // возвращаем дефолт/сохранённый режим для нового контекста.
  useEffect(() => { setPrefs(loadPrefs(readOnly)); }, [readOnly]);

  const updatePrefs = useCallback((patch: Partial<ViewPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(readOnly, next);
      return next;
    });
  }, [readOnly]);
  const handleLayoutChange = useCallback((layout: DiffLayout) => updatePrefs({ layout }), [updatePrefs]);
  const handleToggleWholeFile = useCallback(
    () => updatePrefs({ wholeFile: !prefs.wholeFile }),
    [updatePrefs, prefs.wholeFile],
  );

  const isImage = isImageFile(file);
  const isMarkdown = isMarkdownFile(file);
  const needsFullContext = prefs.wholeFile;
  const { diffs, loading, error } = useFileDiff(file, hash, ignoreWs, needsFullContext, !isImage);

  const handleToggleWs = useCallback(() => {
    setIgnoreWs((prev) => !prev);
  }, []);

  const [mdPreview, setMdPreview] = useState<MarkdownPreviewTarget | null>(null);
  const handlePreviewMarkdown = useCallback(() => {
    setMdPreview({ file, hash });
  }, [file, hash]);

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
          layout={prefs.layout} onLayoutChange={handleLayoutChange}
          wholeFile={prefs.wholeFile} onToggleWholeFile={handleToggleWholeFile}
          onExpand={onExpand ? () => onExpand(file, hash) : undefined}
          onPreviewMarkdown={isMarkdown ? handlePreviewMarkdown : undefined}
        />
      ))}
      {mdPreview && (
        <Suspense fallback={null}>
          <MarkdownPreviewModal target={mdPreview} onClose={() => setMdPreview(null)} />
        </Suspense>
      )}
    </>
  );
}
