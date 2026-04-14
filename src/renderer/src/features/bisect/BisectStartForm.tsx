import { useState } from 'react';
import s from './BisectDialog.module.css';

interface Props {
  labels: { badCommit: string; goodCommit: string; badPlaceholder: string; goodPlaceholder: string; start: string };
  onStart: (bad: string, good: string) => void;
}

/** Form to start a new bisect session with bad/good commit inputs. */
export function BisectStartForm({ labels, onStart }: Props) {
  const [bad, setBad] = useState('HEAD');
  const [good, setGood] = useState('');

  const canStart = bad.trim().length > 0 && good.trim().length > 0;

  return (
    <>
      <div className={s.field}>
        <label className={s.label}>{labels.badCommit}</label>
        <input className={s.input} value={bad} onChange={(e) => setBad(e.target.value)} placeholder={labels.badPlaceholder} />
      </div>
      <div className={s.field}>
        <label className={s.label}>{labels.goodCommit}</label>
        <input className={s.input} value={good} onChange={(e) => setGood(e.target.value)} placeholder={labels.goodPlaceholder} autoFocus />
      </div>
      <button className={s.btnPrimary} disabled={!canStart} onClick={() => onStart(bad.trim(), good.trim())}>
        {labels.start}
      </button>
    </>
  );
}
