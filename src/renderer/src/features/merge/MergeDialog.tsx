import { useState, useEffect } from 'react';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';
import type { MergeOptions } from '../../types';
import { SgDialog } from '../../ui/SgDialog';
import s from './MergeDialog.module.css';

type MergeMode = 'default' | 'no-ff' | 'squash' | 'no-commit';

function modeToOptions(mode: MergeMode): MergeOptions {
  return {
    noCommit: mode === 'no-commit',
    squash: mode === 'squash',
    ffOnly: false,
    noFf: mode === 'no-ff',
  };
}

interface Props {
  source: string;
  target: string;
  onClose: () => void;
}

export function MergeDialog({ source, target, onClose }: Props) {
  const loc = t();
  const [mode, setMode] = useState<MergeMode>('default');
  const [predictedConflicts, setPredictedConflicts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const modeLabels: Record<MergeMode, string> = {
    'default': loc.mergeDialog.modeDefault,
    'no-ff': loc.mergeDialog.modeNoFf,
    'squash': loc.mergeDialog.modeSquash,
    'no-commit': loc.mergeDialog.modeNoCommit,
  };

  useEffect(() => {
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'predictedConflicts') {
        setPredictedConflicts(msg.files);
      }
    });
    postCommand({ type: 'predictConflicts', source, target });
    return unsub;
  }, [source, target]);

  useEffect(() => {
    if (!loading) return;
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'operationEnd' && msg.operation === 'merge') {
        unsub();
        setLoading(false);
        onClose();
      }
    });
    return unsub;
  }, [loading, onClose]);

  const handleMerge = () => {
    setLoading(true);
    postCommand({ type: 'startMerge', source, options: modeToOptions(mode) });
  };

  return (
    <SgDialog
      open
      title={loc.mergeDialog.title}
      onClose={loading ? () => {} : onClose}
      size="md"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="sg-button sg-button--ghost sg-button--md" onClick={onClose} disabled={loading}>
            {loc.mergeEditor.cancel}
          </button>
          <button className="sg-button sg-button--primary sg-button--md" onClick={handleMerge} disabled={loading}>
            {loading ? loc.mergeDialog.merging : loc.mergeEditor.merge}
          </button>
        </div>
      }
    >
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--sg-foreground-muted)' }}>{loc.mergeDialog.subtitle}</p>
      <div className={s.field}>
        <label className={s.label}>{loc.mergeDialog.mergeLabel}</label>
        <span className={s.branchName}>{source}</span>
      </div>
      <div className={s.field}>
        <label className={s.label}>{loc.mergeDialog.intoLabel}</label>
        <span className={s.branchName}>{target}</span>
      </div>
      <div className={s.field}>
        <label className={s.label}>{loc.mergeDialog.optionLabel}</label>
        <select className={s.select} value={mode} onChange={e => setMode(e.target.value as MergeMode)} disabled={loading}>
          {(Object.keys(modeLabels) as MergeMode[]).map(m => (
            <option key={m} value={m}>{modeLabels[m]}</option>
          ))}
        </select>
      </div>

      {predictedConflicts.length > 0 && (
        <div className={s.warning}>
          ⚠ {loc.mergeDialog.warning} ({predictedConflicts.length} {loc.mergeDialog.files})
        </div>
      )}
    </SgDialog>
  );
}
