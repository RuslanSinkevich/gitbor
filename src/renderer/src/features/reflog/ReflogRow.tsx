import type { ReflogEntry } from '../../types';
import { ActionBadge } from './ActionBadge';
import s from './ReflogDialog.module.css';

interface Props {
  entry: ReflogEntry;
  onCopyHash: (hash: string) => void;
  onRestore: (entry: ReflogEntry) => void;
  restoreLabel: string;
}

/** Single row in the reflog table. */
export function ReflogRow({ entry, onCopyHash, onRestore, restoreLabel }: Props) {
  return (
    <tr className={s.row}>
      <td className={s.colHashCell}>
        <span className={s.colHash} onClick={() => onCopyHash(entry.hash)} title={entry.hash}>
          {entry.shortHash}
        </span>
      </td>
      <td className={s.colActionCell}><ActionBadge action={entry.action} /></td>
      <td className={s.colMessage} title={entry.message}>{entry.message}</td>
      <td className={`${s.colDate} ${s.colDateCell}`}>{formatReflogDate(entry.date)}</td>
      <td className={s.colRestore}>
        <button className={s.restoreBtn} onClick={() => onRestore(entry)}>
          {restoreLabel}
        </button>
      </td>
    </tr>
  );
}

/** Formats ISO date string to a short readable format. */
function formatReflogDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
