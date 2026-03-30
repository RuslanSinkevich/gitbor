import { useState, useCallback } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import s from './CommitBar.module.css';

interface Props {
  stagedCount: number;
  isOperationRunning: boolean;
}

export function CommitBar({ stagedCount, isOperationRunning }: Props) {
  const loc = t();
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);

  const canCommit = (message.trim().length > 0 || amend) && stagedCount > 0 && !isOperationRunning;

  const handleCommit = useCallback(() => {
    if (!canCommit) return;
    postCommand({ type: 'commit', message: message.trim(), amend: amend || undefined });
    setMessage('');
    setAmend(false);
  }, [canCommit, message, amend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleCommit();
    }
  };

  return (
    <div className={s.root}>
      <textarea
        className={s.input}
        placeholder={loc.changes.commitMessage}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
      />
      <div className={s.actions}>
        <label className={s.amend}>
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          <span>{loc.changes.amend}</span>
        </label>
        <button className={s.button} disabled={!canCommit} onClick={handleCommit}>
          {loc.changes.commit}
          {stagedCount > 0 && <span className={s.count}>({stagedCount})</span>}
        </button>
      </div>
    </div>
  );
}
