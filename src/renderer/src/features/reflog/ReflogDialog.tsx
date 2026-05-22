import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent, copyToClipboard } from '../../api';
import { t, tpl } from '../../i18n';
import type { ReflogEntry } from '../../types';
import type { ShowPrompt } from '../graph/commitMenuItems';
import { SgDialog } from '../../ui/SgDialog';
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
      kind: 'confirm',
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
    <SgDialog
      open
      title={rl.title}
      onClose={onClose}
      size="xl"
      footer={<button className="sg-button sg-button--ghost sg-button--md" onClick={onClose}>{loc.dialog.close}</button>}
    >
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--sg-foreground-muted)' }}>{rl.subtitle}</p>
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
    </SgDialog>
  );
}
