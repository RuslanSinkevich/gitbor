import { useState, useEffect } from 'react';
import { postCommand, onMainEvent } from '../../api';
import type { MergeOptions } from '../../types';
import s from './Merge.module.css';

type MergeMode = 'default' | 'no-ff' | 'squash' | 'no-commit';

const MODE_LABELS: Record<MergeMode, string> = {
  'default': 'Default — Fast-forward if possible',
  'no-ff': 'No Fast-Forward — Always create a merge commit',
  'squash': 'Squash — Squash merge',
  'no-commit': "Don't Commit — Merge without commit",
};

function modeToOptions(mode: MergeMode): MergeOptions {
  return {
    noCommit: mode === 'no-commit',
    squash: mode === 'squash',
    ffOnly: false,
  };
}

interface Props {
  source: string;
  target: string;
  onClose: () => void;
}

export function MergeDialog({ source, target, onClose }: Props) {
  const [mode, setMode] = useState<MergeMode>('default');
  const [predictedConflicts, setPredictedConflicts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'predictedConflicts') {
        setPredictedConflicts(msg.files);
      }
    });
    postCommand({ type: 'predictConflicts', source, target });
    return unsub;
  }, [source, target]);

  const handleMerge = () => {
    setLoading(true);
    postCommand({ type: 'startMerge', source, options: modeToOptions(mode) });
    onClose();
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={e => e.stopPropagation()}>
        <div className={s.dialogHeader}>
          <h3 className={s.dialogTitle}>Merge Branch</h3>
          <span className={s.dialogSubtitle}>Merge branch into another one</span>
        </div>

        <div className={s.dialogBody}>
          <div className={s.field}>
            <label className={s.label}>Merge:</label>
            <span className={s.branchName}>{source}</span>
          </div>
          <div className={s.field}>
            <label className={s.label}>Into:</label>
            <span className={s.branchName}>{target}</span>
          </div>
          <div className={s.field}>
            <label className={s.label}>Merge Option:</label>
            <select className={s.select} value={mode} onChange={e => setMode(e.target.value as MergeMode)}>
              {(Object.keys(MODE_LABELS) as MergeMode[]).map(m => (
                <option key={m} value={m}>{MODE_LABELS[m]}</option>
              ))}
            </select>
          </div>

          {predictedConflicts.length > 0 && (
            <div className={s.warning}>
              ⚠ Merge will cause conflicts ({predictedConflicts.length} file{predictedConflicts.length > 1 ? 's' : ''})
            </div>
          )}
        </div>

        <div className={s.dialogFooter}>
          <button className={s.btnPrimary} onClick={handleMerge} disabled={loading}>
            {loading ? 'Merging...' : 'Merge'}
          </button>
          <button className={s.btnSecondary} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
