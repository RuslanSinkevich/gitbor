import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent, copyToClipboard } from '../../api';
import { t, tpl } from '../../i18n';
import type { ReflogEntry } from '../../types';
import type { ShowPrompt } from '../graph/commitMenuItems';
import { ReflogTable } from './ReflogTable';
import s from './ReflogDialog.module.css';

interface Props {
  onClose: () => void;
  showPrompt: ShowPrompt;
}

/** Dialog showing git reflog with ability to restore (hard reset) to any entry. */
export function ReflogDialog({ onClose, showPrompt }: Props) {
  const loc = t();
  const rl = loc.reflog;
  const [entries, setEntries] = useState<ReflogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'reflog') {
        setEntries(msg.data);
        setLoading(false);
      }
    });
    postCommand({ type: 'getReflog', maxCount: 100 });
    return unsub;
  }, []);

  const handleCopyHash = useCallback((hash: string) => {
    copyToClipboard(hash);
  }, []);

  const handleRestore = useCallback((entry: ReflogEntry) => {
    showPrompt({
      title: rl.restoreTitle,
      message: tpl(rl.restoreConfirm, { hash: entry.shortHash }),
      confirmLabel: rl.restore,
      danger: true,
      onConfirm: () => {
        postCommand({ type: 'restoreReflog', hash: entry.hash });
        onClose();
      },
    });
  }, [rl, showPrompt, onClose]);

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <h3 className={s.title}>{rl.title}</h3>
          <p className={s.subtitle}>{rl.subtitle}</p>
        </div>

        <div className={s.body}>
          {loading ? (
            <div className={s.loading}>{loc.app.loading}</div>
          ) : entries.length === 0 ? (
            <div className={s.empty}>{rl.empty}</div>
          ) : (
            <ReflogTable
              entries={entries}
              headerLabels={{ hash: rl.hash, action: rl.action, message: rl.message, date: rl.date }}
              restoreLabel={rl.restore}
              onCopyHash={handleCopyHash}
              onRestore={handleRestore}
            />
          )}
        </div>

        <div className={s.footer}>
          <button className={s.btnSecondary} onClick={onClose}>{loc.dialog.close}</button>
        </div>
      </div>
    </div>
  );
}
