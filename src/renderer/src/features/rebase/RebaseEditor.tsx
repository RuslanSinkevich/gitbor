import { useEffect, useState, useCallback } from 'react';
import type { RebaseTodoEntry, RebaseTodoList, RebaseAction } from '../../types';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
import s from './RebaseEditor.module.css';

interface Props {
  onto: string;
  onClose: () => void;
}

const ACTIONS: RebaseAction[] = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'];

export function RebaseEditor({ onto, onClose }: Props) {
  const loc = t();
  const [entries, setEntries] = useState<RebaseTodoEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'rebaseTodo') {
        setEntries([...msg.data.entries]);
        setLoading(false);
      }
    });
    postCommand({ type: 'getRebaseTodo', onto });
    return unsub;
  }, [onto]);

  const setAction = useCallback((idx: number, action: RebaseAction) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, action } : e));
  }, []);

  const moveEntry = useCallback((idx: number, dir: -1 | 1) => {
    setEntries(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    if (!executing) return;
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'operationEnd' && msg.operation === 'rebase') {
        setExecuting(false);
        onClose();
      }
    });
    return unsub;
  }, [executing, onClose]);

  const handleExecute = () => {
    setExecuting(true);
    postCommand({ type: 'executeRebase', onto, entries });
  };

  if (loading) return <div className={s.empty}>{loc.rebaseEditor.loading}</div>;
  if (entries.length === 0) return <div className={s.empty}>{loc.rebaseEditor.noCommits}</div>;

  return (
    <div className={s.root}>
      <div className={s.header}>
        <span className={s.title}>{loc.rebaseEditor.title}</span>
        <span className={s.ontoLabel}>{loc.rebaseEditor.onto}: {onto}</span>
      </div>

      <div className={s.list}>
        {entries.map((entry, i) => (
          <div
            key={entry.hash}
            className={`${s.entry} ${entry.action === 'drop' ? s.actionDrop : ''}`}
          >
            <span className={s.dragHandle}>⠿</span>
            <div className={s.moveButtons}>
              <button className={s.moveBtn} onClick={() => moveEntry(i, -1)} disabled={i === 0}>▲</button>
              <button className={s.moveBtn} onClick={() => moveEntry(i, 1)} disabled={i === entries.length - 1}>▼</button>
            </div>
            <select
              className={s.actionSelect}
              value={entry.action}
              onChange={e => setAction(i, e.target.value as RebaseAction)}
            >
              {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <span className={s.hash}>{entry.shortHash}</span>
            <span className={s.subject}>{entry.subject}</span>
          </div>
        ))}
      </div>

      <div className={s.footer}>
        <button className="sg-btn sg-btn--ghost" onClick={onClose}>{loc.rebaseEditor.cancel}</button>
        <button className="sg-btn sg-btn--primary" onClick={handleExecute}>{loc.rebaseEditor.startRebase}</button>
      </div>
    </div>
  );
}
