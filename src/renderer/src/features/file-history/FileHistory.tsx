import { useEffect, useState } from 'react';
import type { FileHistoryResult, FileHistoryEntry } from '../../types';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import s from './FileHistory.module.css';

interface Props {
  file: string;
  onSelectEntry?: (entry: FileHistoryEntry) => void;
  onOpenDiff?: (file: string, hash: string) => void;
  /** App-level контекстное меню (ПКМ по строке журнала). */
  onContextMenu?: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
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

export function FileHistory({ file, onSelectEntry, onOpenDiff, onContextMenu }: Props) {
  const loc = t();
  const [history, setHistory] = useState<FileHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);

  /**
   * ПКМ по строке коммита (журнал в стиле VS). Действия:
   *  - «Просмотр изменений» — diff файла в этом коммите (hash^..hash);
   *  - «Сравнить с предыдущим» — diff между предыдущей ревизией ФАЙЛА и
   *    этим коммитом (`PREV:<hash>` резолвится бэкендом в prev..hash);
   *  - «Сравнить с…» — выбрать любой коммит НИЖЕ в списке (старее) и
   *    показать diff `старее..этот` для файла (`<old>..<hash>`).
   * Сравнение идёт по текущему пути файла; для линейной истории совпадает
   * с «предыдущим в графе». Rename-цепочки `--follow` не учитываем (опц.).
   */
  const buildMenu = (entry: FileHistoryEntry, index: number): SgContextMenuItem[] => {
    const older = history ? history.entries.slice(index + 1) : [];
    const items: SgContextMenuItem[] = [
      { label: loc.fileHistory.view, action: () => { setSelectedHash(entry.hash); onOpenDiff?.(file, entry.hash); } },
      { label: loc.fileHistory.compareWithPrevious, action: () => { setSelectedHash(entry.hash); onOpenDiff?.(file, `PREV:${entry.hash}`); } },
      { divider: true },
    ];
    if (older.length === 0) {
      items.push({ label: loc.fileHistory.compareWith, disabled: true });
    } else {
      items.push({
        label: loc.fileHistory.compareWith,
        submenu: older.map((o) => ({
          label: `${o.shortHash}  ${o.subject}`.slice(0, 80),
          action: () => { setSelectedHash(entry.hash); onOpenDiff?.(file, `${o.hash}..${entry.hash}`); },
        })),
      });
    }
    return items;
  };

  useEffect(() => {
    setLoading(true);
    setHistory(null);

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'fileHistory' && msg.file === file) {
        setHistory(msg.data);
        setLoading(false);
      }
    });

    postCommand({ type: 'getFileHistory', file });

    return unsub;
  }, [file]);

  if (loading) return <div className={s.empty}>{loc.fileHistory.loading}</div>;
  if (!history || history.entries.length === 0) return <div className={s.empty}>{loc.fileHistory.noHistory}</div>;

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        <span className={s.filePath}>{loc.fileHistory.history}: {file}</span>
        <span style={{ fontSize: 11, color: 'var(--sg-foreground-muted)' }}>
          {history.entries.length} {loc.fileHistory.commits}
        </span>
      </div>
      <div className={s.list}>
        {history.entries.map((entry, index) => (
          <div
            key={entry.hash}
            className={`${s.entry} ${selectedHash === entry.hash ? s.entrySelected : ''}`}
            onClick={() => {
              setSelectedHash(entry.hash);
              onSelectEntry?.(entry);
              onOpenDiff?.(file, entry.hash);
            }}
            onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, buildMenu(entry, index)); } : undefined}
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
