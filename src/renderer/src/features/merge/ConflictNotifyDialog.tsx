import { t } from '../../i18n';
import type { MergeState } from '../../types';
import s from './Merge.module.css';

interface Props {
  mergeState: MergeState;
  onClose: () => void;
  onOpenMergeEditor?: (file: string) => void;
}

export function ConflictNotifyDialog({ mergeState, onClose, onOpenMergeEditor }: Props) {
  const loc = t();
  const conflicted = mergeState.conflictFiles.filter(f => f.status === 'conflicted');

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={e => e.stopPropagation()}>
        <div className={s.dialogHeader}>
          <h3 className={s.dialogTitle}>{loc.conflictDialog.title}</h3>
          <span className={s.dialogSubtitle}>{loc.conflictDialog.subtitle}</span>
        </div>

        <div className={s.dialogBody}>
          <div className={s.conflictOutput}>
            {conflicted.map(f => (
              <div
                key={f.path}
                style={{ cursor: onOpenMergeEditor ? 'pointer' : 'default', padding: '2px 0' }}
                onClick={() => { if (onOpenMergeEditor) { onOpenMergeEditor(f.path); onClose(); } }}
              >
                {loc.conflictDialog.conflict}: {f.path}
                {onOpenMergeEditor && <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>→ {loc.contextMenu.openMergeEditor}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className={s.dialogFooter}>
          <button className={s.btnSecondary} onClick={onClose}>{loc.dialog.close}</button>
        </div>
      </div>
    </div>
  );
}
