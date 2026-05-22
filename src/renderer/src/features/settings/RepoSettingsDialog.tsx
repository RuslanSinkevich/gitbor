import { useState, useEffect, useCallback, useRef } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
import type { MainEvent } from '../../types';
import { SgDialog } from '../../ui/SgDialog';
import s from './RepoSettingsDialog.module.css';

interface RepoSettings {
  localName: string;
  localEmail: string;
  globalName: string;
  globalEmail: string;
  useGlobal: boolean;
}

interface Props {
  onClose: () => void;
}

export function RepoSettingsDialog({ onClose }: Props) {
  const loc = t().repoSettings;
  const [settings, setSettings] = useState<RepoSettings | null>(null);
  const [useGlobal, setUseGlobal] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    postCommand({ type: 'getRepoSettings' });
    const unsub = onMainEvent((msg: MainEvent) => {
      if (msg.type === 'repoSettings') {
        const d = msg.data as RepoSettings;
        setSettings(d);
        setUseGlobal(d.useGlobal);
        setName(d.useGlobal ? d.globalName : d.localName);
        setEmail(d.useGlobal ? d.globalEmail : d.localEmail);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!settings) return;
    if (useGlobal) {
      setName(settings.globalName);
      setEmail(settings.globalEmail);
    } else {
      setName(settings.localName || settings.globalName);
      setEmail(settings.localEmail || settings.globalEmail);
    }
  }, [useGlobal, settings]);

  const savedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const handleSave = useCallback(() => {
    postCommand({ type: 'setRepoSettings', useGlobal, name, email });
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }, [useGlobal, name, email]);

  if (!settings) return null;

  const initials = (name || 'U')[0].toUpperCase();

  return (
    <SgDialog
      open
      title={loc.title}
      onClose={onClose}
      size="md"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="sg-button sg-button--ghost sg-button--sm" onClick={onClose}>
            {loc.close}
          </button>
          {!useGlobal && (
            <button
              className="sg-button sg-button--primary sg-button--sm"
              onClick={handleSave}
            >
              {saved ? loc.saved : loc.save}
            </button>
          )}
        </div>
      }
    >
      <h3 className={s.section}>{loc.userInfo}</h3>

      <label className={s.checkboxRow}>
        <input
          type="checkbox"
          checked={useGlobal}
          aria-label={loc.useGlobal}
          onChange={e => setUseGlobal(e.target.checked)}
        />
        <span>{loc.useGlobal}</span>
      </label>

      <div className={s.userRow}>
        <div className={s.avatar}>{initials}</div>
        <div className={s.fields}>
          <div className={s.fieldRow}>
            <label>{loc.userName}</label>
            <input
              className="sg-input"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={useGlobal}
            />
          </div>
          <div className={s.fieldRow}>
            <label>{loc.userEmail}</label>
            <input
              className="sg-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={useGlobal}
            />
          </div>
        </div>
      </div>
    </SgDialog>
  );
}
