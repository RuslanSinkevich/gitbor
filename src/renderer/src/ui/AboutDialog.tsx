import { useEffect, useState } from 'react';
import type { t } from '../i18n';
import { postCommand, onMainEvent } from '../api';
import { SgDialog } from './SgDialog';
import s from './AboutDialog.module.css';

interface Props {
  onClose: () => void;
  loc: ReturnType<typeof t>;
  /** Открыть диалог «спасибо автору» (та же модалка, что раз в неделю). */
  onSayThanks?: () => void;
}

export function AboutDialog({ onClose, loc, onSayThanks }: Props) {
  const [version, setVersion] = useState('…');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void window.gitBorAPI?.getAppVersion().then((v) => setVersion(v)).catch(() => setVersion('?'));
  }, []);

  // useAppUpdater уже слушает appUpdateManualResult и показывает диалог.
  // Здесь дублируем подписку только чтобы снять checking-флаг — иначе
  // кнопка остаётся "Проверка…" пока диалог открыт.
  useEffect(() => {
    if (!checking) return;
    const off = onMainEvent((msg) => {
      if (msg.type === 'appUpdateManualResult') setChecking(false);
    });
    return off;
  }, [checking]);

  const handleCheck = () => {
    if (checking) return;
    setChecking(true);
    void postCommand({ type: 'checkForUpdates' });
  };

  return (
    <SgDialog
      open
      title="GitBor"
      onClose={onClose}
      size="sm"
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 }}>
          {onSayThanks ? (
            <button
              type="button"
              className="sg-button sg-button--sm sg-button--ghost"
              onClick={() => { onSayThanks(); onClose(); }}
            >
              {loc.aboutDialog.sayThanks}
            </button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="sg-button sg-button--sm sg-button--ghost"
              onClick={handleCheck}
              disabled={checking}
            >
              {checking ? loc.aboutDialog.checkingUpdates : loc.aboutDialog.checkUpdates}
            </button>
            <button type="button" className="sg-button sg-button--primary sg-button--sm" onClick={onClose}>
              {loc.dialog.close}
            </button>
          </div>
        </div>
      }
    >
      <p className={s.version}>v{version}</p>
      <p className={s.desc}>{loc.aboutDialog.product}</p>
      <div className={s.section}>
        <h3 className={s.sectionTitle}>{loc.aboutDialog.aboutMeTitle}</h3>
        <p className={s.authorName}>{loc.aboutDialog.authorName}</p>
        <p className={s.sectionText}>{loc.aboutDialog.authorRole}</p>
        <p className={s.sectionText}>{loc.aboutDialog.authorBio}</p>
        <a
          className={s.link}
          href="https://ruslansinkevich.ru/"
          target="_blank"
          rel="noreferrer"
        >
          {loc.aboutDialog.more}
        </a>
      </div>
      <p className={s.copy}>&copy; 2026 Ruslan Sinkevich</p>
    </SgDialog>
  );
}
