import { useState, useRef } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import s from './CommitBar.module.css';

interface Props {
  stagedCount: number;
  isOperationRunning: boolean;
}

export function CommitBar({ stagedCount, isOperationRunning }: Props) {
  const loc = t();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [amend, setAmend] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const canCommit = (subject.trim().length > 0 || amend) && stagedCount > 0 && !isOperationRunning;

  function doCommit() {
    if (!canCommit) return;
    const subj = subject.trim();
    const desc = description.trim();
    const msg = desc ? `${subj}\n\n${desc}` : subj;
    postCommand({ type: 'commit', message: msg, amend: amend || undefined });
    setSubject('');
    setDescription('');
    setAmend(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doCommit();
    }
  }

  function onSubjectKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      descRef.current?.focus();
      return;
    }
    onKeyDown(e);
  }

  return (
    <div className={s.root}>
      <div className={s.fields}>
        <input
          className={s.subject}
          type="text"
          placeholder={loc.changes.commitSubject}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={onSubjectKeyDown}
        />
        <textarea
          ref={descRef}
          className={s.description}
          placeholder={loc.changes.commitDescription}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />
      </div>
      <div className={s.actions}>
        <label className={s.amend}>
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          <span>{loc.changes.amend}</span>
        </label>
        <button className={s.button} disabled={!canCommit} onClick={doCommit}>
          {loc.changes.commit}
          {stagedCount > 0 && <span className={s.count}>({stagedCount})</span>}
        </button>
      </div>
    </div>
  );
}
