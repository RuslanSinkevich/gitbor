import { useEffect, useState } from 'react';
import type { FileHistoryResult, FileHistoryEntry } from '../../types';
import { postCommand, onMainEvent } from '../../api';
import s from './FileHistory.module.css';

interface Props {
  file: string;
  onSelectEntry?: (entry: FileHistoryEntry) => void;
  onOpenDiff?: (file: string, hash: string) => void;
}

function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusCls(status: string): string {
  switch (status) {
    case 'M': return s.statusM;
    case 'A': return s.statusA;
    case 'D': return s.statusD;
    case 'R': return s.statusR;
    default: return '';
  }
}

export function FileHistory({ file, onSelectEntry, onOpenDiff }: Props) {
  const [history, setHistory] = useState<FileHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setHistory(null);

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'fileHistory') {
        setHistory(msg.data);
        setLoading(false);
      }
    });

    postCommand({ type: 'getFileHistory', file });

    return unsub;
  }, [file]);

  if (loading) return <div className={s.empty}>Loading history...</div>;
  if (!history || history.entries.length === 0) return <div className={s.empty}>No history</div>;

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <span className={s.filePath}>History: {file}</span>
        <span style={{ fontSize: 11, color: 'var(--sg-foreground-muted)' }}>
          {history.entries.length} commit{history.entries.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className={s.list}>
        {history.entries.map(entry => (
          <div
            key={entry.hash}
            className={`${s.entry} ${selectedHash === entry.hash ? s.entrySelected : ''}`}
            onClick={() => {
              setSelectedHash(entry.hash);
              onSelectEntry?.(entry);
              onOpenDiff?.(file, entry.hash);
            }}
          >
            <span className={`${s.entryStatus} ${statusCls(entry.status)}`}>{entry.status}</span>
            <span className={s.entryHash}>{entry.shortHash}</span>
            <span className={s.entrySubject}>{entry.subject}</span>
            <span className={s.entryAuthor}>{entry.authorName}</span>
            <span className={s.entryDate}>{formatDate(entry.authorDate)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
