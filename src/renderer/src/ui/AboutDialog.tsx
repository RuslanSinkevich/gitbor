import { useEffect } from 'react';
import type { t } from '../i18n';
import s from './AboutDialog.module.css';

interface Props {
  onClose: () => void;
  loc: ReturnType<typeof t>;
}

export function AboutDialog({ onClose, loc }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <h2>SkyFork</h2>
        <p className={s.version}>v0.1.0</p>
        <p className={s.desc}>Fast & lightweight Git client</p>
        <p className={s.copy}>&copy; 2026 Skycode</p>
        <button className="sg-button sg-button--primary sg-button--sm" onClick={onClose}>
          {loc.dialog.close}
        </button>
      </div>
    </div>
  );
}
