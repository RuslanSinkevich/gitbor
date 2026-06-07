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
  onOpenSshKeys?: () => void;
}

type CredTarget = { displayUrl: string; suggestedUsername: string } | null;

export function RepoSettingsDialog({ onClose, onOpenSshKeys }: Props) {
  const loc = t().repoSettings;
  const [settings, setSettings] = useState<RepoSettings | null>(null);
  const [useGlobal, setUseGlobal] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saved, setSaved] = useState(false);

  // Remote-доступ (HTTPS credential helper).
  const [credLoaded, setCredLoaded] = useState(false);
  const [credTarget, setCredTarget] = useState<CredTarget>(null);
  const [helperConfigured, setHelperConfigured] = useState(true);
  const [credUser, setCredUser] = useState('');
  const [credPass, setCredPass] = useState('');
  const [credStatus, setCredStatus] = useState<string | null>(null);

  useEffect(() => {
    postCommand({ type: 'getRepoSettings' });
    postCommand({ type: 'getCredentialInfo' });
    const unsub = onMainEvent((msg: MainEvent) => {
      if (msg.type === 'repoSettings') {
        const d = msg.data as RepoSettings;
        setSettings(d);
        setUseGlobal(d.useGlobal);
        setName(d.useGlobal ? d.globalName : d.localName);
        setEmail(d.useGlobal ? d.globalEmail : d.localEmail);
      } else if (msg.type === 'credentialInfo') {
        setCredLoaded(true);
        setHelperConfigured(msg.data.helperConfigured);
        if (msg.data.target) {
          setCredTarget({ displayUrl: msg.data.target.displayUrl, suggestedUsername: msg.data.target.suggestedUsername });
          setCredUser(msg.data.target.suggestedUsername);
        } else {
          setCredTarget(null);
        }
      } else if (msg.type === 'credentialUpdated') {
        if (msg.success) {
          setCredStatus(msg.cleared ? loc.credCleared : loc.credUpdated);
          if (msg.cleared) setCredPass('');
        } else {
          setCredStatus(msg.error || '');
        }
      }
    });
    return unsub;
  }, [loc.credCleared, loc.credUpdated]);

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

  const handleCredUpdate = useCallback(() => {
    setCredStatus(null);
    postCommand({ type: 'updateCredentials', username: credUser.trim(), password: credPass });
  }, [credUser, credPass]);

  const handleCredClear = useCallback(() => {
    setCredStatus(null);
    postCommand({ type: 'clearCredentials' });
  }, []);

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

      {credLoaded && (
        <>
          <h3 className={`${s.section} ${s.sectionTop}`}>{loc.remoteAccess}</h3>
          {credTarget ? (
            <div className={s.fields}>
              <div className={s.fieldRow}>
                <label>{loc.remoteUrl}</label>
                <input className="sg-input" value={credTarget.displayUrl} readOnly />
              </div>
              <div className={s.fieldRow}>
                <label>{loc.credUsername}</label>
                <input
                  className="sg-input"
                  value={credUser}
                  onChange={e => { setCredUser(e.target.value); setCredStatus(null); }}
                  autoComplete="off"
                />
              </div>
              <div className={s.fieldRow}>
                <label>{loc.credPassword}</label>
                <input
                  className="sg-input"
                  type="password"
                  value={credPass}
                  onChange={e => { setCredPass(e.target.value); setCredStatus(null); }}
                  autoComplete="off"
                />
              </div>
              <p className={s.credHint}>{loc.credHint}</p>
              {!helperConfigured && <p className={s.credWarn}>{loc.credNoHelper}</p>}
              {credStatus && <p className={s.credStatus}>{credStatus}</p>}
              <div className={s.credActions}>
                <button
                  className="sg-button sg-button--primary sg-button--sm"
                  onClick={handleCredUpdate}
                  disabled={!credUser.trim() || !credPass}
                >
                  {loc.credUpdate}
                </button>
                <button className="sg-button sg-button--ghost sg-button--sm" onClick={handleCredClear}>
                  {loc.credClear}
                </button>
              </div>
            </div>
          ) : (
            <div className={s.fields}>
              <p className={s.credHint}>{loc.credSshHint}</p>
              {onOpenSshKeys && (
                <div className={s.credActions}>
                  <button className="sg-button sg-button--ghost sg-button--sm" onClick={onOpenSshKeys}>
                    {loc.credOpenSsh}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </SgDialog>
  );
}
