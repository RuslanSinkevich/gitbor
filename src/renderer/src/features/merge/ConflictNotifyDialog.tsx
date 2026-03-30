import type { MergeState } from '../../types';
import s from './Merge.module.css';

interface Props {
  mergeState: MergeState;
  onClose: () => void;
}

export function ConflictNotifyDialog({ mergeState, onClose }: Props) {
  const conflicted = mergeState.conflictFiles.filter(f => f.status === 'conflicted');

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={e => e.stopPropagation()}>
        <div className={s.dialogHeader}>
          <h3 className={s.dialogTitle}>Merge Conflict</h3>
          <span className={s.dialogSubtitle}>Automatic merge failed. Fix conflicts and then commit the result</span>
        </div>

        <div className={s.dialogBody}>
          <div className={s.conflictOutput}>
            {conflicted.map(f => (
              <div key={f.path}>CONFLICT (content): Merge conflict in {f.path}</div>
            ))}
            <div>Automatic merge failed; fix conflicts and then commit the result.</div>
          </div>
        </div>

        <div className={s.dialogFooter}>
          <button className={s.btnSecondary} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
