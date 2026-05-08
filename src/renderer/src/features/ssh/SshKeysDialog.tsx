import { useState, useEffect, useCallback, useRef } from 'react';
import { postCommand, onMainEvent, copyToClipboard } from '../../api';
import { t, tpl } from '../../i18n';
import type { MainEvent } from '../../types';
import s from './SshKeysDialog.module.css';

interface SshKeyInfo {
  name: string;
  type: string;
  bits: string;
  fingerprint: string;
  comment: string;
}

interface Props {
  onClose: () => void;
}

export function SshKeysDialog({ onClose }: Props) {
  const loc = t().sshKeys;
  const [keys, setKeys] = useState<SshKeyInfo[]>([]);
  const [showGenerate, setShowGenerate] = useState(false);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useEffect(() => {
    postCommand({ type: 'listSshKeys' });
    const unsub = onMainEvent((msg: MainEvent) => {
      if (msg.type === 'sshKeys') setKeys(msg.data as SshKeyInfo[]);
      if (msg.type === 'publicKey') {
        copyToClipboard(msg.content);
        setCopiedName(msg.name);
        clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopiedName(null), 2000);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = useCallback((name: string) => {
    postCommand({ type: 'getPublicKey', name });
  }, []);

  const handleDelete = useCallback((name: string) => {
    if (confirm(tpl(loc.deleteConfirm, { name }))) {
      postCommand({ type: 'deleteSshKey', name });
    }
  }, [loc]);

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={e => e.stopPropagation()}>
        <div className={s.header}>
          <div>
            <h2>{loc.title}</h2>
            <p className={s.subtitle}>{loc.subtitle}</p>
          </div>
          <button className={s.closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div className={s.body}>
          {keys.length === 0 ? (
            <div className={s.empty}>{loc.noKeys}</div>
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{loc.name}</th>
                  <th>{loc.type}</th>
                  <th>{loc.fingerprint}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.name}>
                    <td className={s.keyName}>
                      {k.name}
                      {k.comment && <span className={s.comment}>{k.comment}</span>}
                    </td>
                    <td className={s.keyType}>{k.type.replace('ssh-', '')}</td>
                    <td className={s.fingerprint}>{k.fingerprint || '—'}</td>
                    <td className={s.actions}>
                      <button
                        className="sg-button sg-button--ghost sg-button--sm"
                        onClick={() => handleCopy(k.name)}
                      >
                        {copiedName === k.name ? loc.copied : loc.copyPublicKey}
                      </button>
                      <button
                        className="sg-button sg-button--danger sg-button--sm"
                        onClick={() => handleDelete(k.name)}
                      >
                        {loc.delete}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {showGenerate ? (
          <GenerateForm
            loc={loc}
            onDone={() => setShowGenerate(false)}
          />
        ) : (
          <div className={s.footer}>
            <button
              className="sg-button sg-button--primary sg-button--sm"
              onClick={() => setShowGenerate(true)}
            >
              + {loc.newKey}
            </button>
            <div className={s.footerRight}>
              <button className="sg-button sg-button--ghost sg-button--sm" onClick={onClose}>
                {loc.close}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GenerateForm({ loc, onDone }: { loc: ReturnType<typeof t>['sshKeys']; onDone: () => void }) {
  const [name, setName] = useState('id_ed25519');
  const [keyType, setKeyType] = useState<'ed25519' | 'rsa'>('ed25519');
  const [passphrase, setPassphrase] = useState('');
  const [comment, setComment] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!generating) return;
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'sshKeys') {
        setGenerating(false);
        onDone();
      }
    });
    const fallback = setTimeout(() => { setGenerating(false); onDone(); }, 5000);
    return () => { unsub(); clearTimeout(fallback); };
  }, [generating, onDone]);

  const handleGenerate = () => {
    if (!name.trim()) return;
    setGenerating(true);
    postCommand({
      type: 'generateSshKey',
      name: name.trim(),
      keyType,
      passphrase,
      comment: comment || name.trim(),
    });
  };

  return (
    <div className={s.generateForm}>
      <div className={s.formRow}>
        <label>{loc.keyName}</label>
        <input className="sg-input" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className={s.formRow}>
        <label>{loc.keyType}</label>
        <select className="sg-select" value={keyType} onChange={e => setKeyType(e.target.value as 'ed25519' | 'rsa')}>
          <option value="ed25519">{loc.keyTypeEd25519}</option>
          <option value="rsa">{loc.keyTypeRsa}</option>
        </select>
      </div>
      <div className={s.formRow}>
        <label>{loc.passphrase}</label>
        <input className="sg-input" type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)} />
      </div>
      <div className={s.formRow}>
        <label>{loc.comment}</label>
        <input className="sg-input" value={comment} onChange={e => setComment(e.target.value)} placeholder="user@host" />
      </div>
      <div className={s.formActions}>
        <button
          className="sg-button sg-button--primary sg-button--sm"
          onClick={handleGenerate}
          disabled={generating || !name.trim()}
        >
          {generating ? loc.generating : loc.generate}
        </button>
        <button className="sg-button sg-button--ghost sg-button--sm" onClick={onDone}>
          {t().dialog.cancel}
        </button>
      </div>
    </div>
  );
}
