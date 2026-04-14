import type { ReflogEntry } from '../../types';
import { ReflogRow } from './ReflogRow';
import s from './ReflogDialog.module.css';

interface Props {
  entries: ReflogEntry[];
  headerLabels: { hash: string; action: string; message: string; date: string };
  restoreLabel: string;
  onCopyHash: (hash: string) => void;
  onRestore: (entry: ReflogEntry) => void;
}

/** Reflog entries table with header and rows. */
export function ReflogTable({ entries, headerLabels, restoreLabel, onCopyHash, onRestore }: Props) {
  return (
    <table className={s.table}>
      <thead>
        <tr className={s.tableHead}>
          <th>{headerLabels.hash}</th>
          <th>{headerLabels.action}</th>
          <th>{headerLabels.message}</th>
          <th>{headerLabels.date}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <ReflogRow
            key={`${entry.index}-${entry.hash}`}
            entry={entry}
            onCopyHash={onCopyHash}
            onRestore={onRestore}
            restoreLabel={restoreLabel}
          />
        ))}
      </tbody>
    </table>
  );
}
