import { useState } from 'react';
import { t } from '../../i18n';
import s from './DiffView.module.css';

interface Props {
  file: string;
  hash: string;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']);

export function isImageFile(path: string): boolean {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

type ViewMode = 'side-by-side' | 'diff' | 'single';

export function ImageDiff({ file, hash }: Props) {
  const loc = t();
  const [mode, setMode] = useState<ViewMode>('side-by-side');
  const [opacity, setOpacity] = useState(50);

  const isCommitDiff = hash !== 'WORKING' && hash !== 'STAGED';
  const currentSrc = `file://${file}`;

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <span className={s.filePath}>{file}</span>
        <div className={s.modeToggle}>
          <button className={`${s.modeBtn} ${mode === 'side-by-side' ? s.modeBtnActive : ''}`} onClick={() => setMode('side-by-side')}>
            {loc.diff.imageSideBySide}
          </button>
          <button className={`${s.modeBtn} ${mode === 'diff' ? s.modeBtnActive : ''}`} onClick={() => setMode('diff')}>
            {loc.diff.imageOverlay}
          </button>
          <button className={`${s.modeBtn} ${mode === 'single' ? s.modeBtnActive : ''}`} onClick={() => setMode('single')}>
            {loc.diff.imageCurrent}
          </button>
        </div>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', overflow: 'auto', flex: 1 }}>
        {isCommitDiff ? (
          <div style={{ color: 'var(--sg-foreground-muted)', textAlign: 'center' }}>
            <p>{loc.diff.imageBinary}</p>
            <p style={{ fontSize: 12 }}>{file}</p>
          </div>
        ) : mode === 'single' ? (
          <div style={{ maxWidth: '100%' }}>
            <img src={currentSrc} alt={file} style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', border: '1px solid var(--sg-border)' }} />
          </div>
        ) : mode === 'side-by-side' ? (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', maxWidth: '100%' }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--sg-foreground-muted)' }}>{loc.diff.imagePrevious}</div>
              <div style={{ border: '1px solid var(--sg-border)', padding: 8, background: 'var(--sg-background-alt, #2a2a2a)', minHeight: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'var(--sg-foreground-muted)', fontSize: 12 }}>{hash === 'WORKING' ? loc.diff.imageHeadVersion : loc.diff.imageNotApplicable}</span>
              </div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--sg-foreground-muted)' }}>{loc.diff.imageCurrent}</div>
              <img src={currentSrc} alt={file} style={{ maxWidth: '100%', maxHeight: '50vh', objectFit: 'contain', border: '1px solid var(--sg-border)' }} />
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative', maxWidth: '100%' }}>
            <img src={currentSrc} alt={file} style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', opacity: opacity / 100, border: '1px solid var(--sg-border)' }} />
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12 }}>{loc.diff.imageOpacity}</span>
              <input type="range" min={0} max={100} value={opacity} onChange={e => setOpacity(Number(e.target.value))} style={{ flex: 1 }} />
              <span style={{ fontSize: 12 }}>{opacity}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
