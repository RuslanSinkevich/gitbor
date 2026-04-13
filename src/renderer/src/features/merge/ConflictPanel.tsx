import { useState, useEffect } from 'react';
import { postCommand } from '../../api';
import { t } from '../../i18n';
import type { MergeState } from '../../types';
import s from './ConflictPanel.module.css';

interface Props {
  file: string;
  mergeState: MergeState;
  onOpenEditor: (file: string) => void;
  onResolved?: () => void;
}

export function ConflictPanel({ file, mergeState, onOpenEditor, onResolved }: Props) {
  const loc = t();
  const cp = loc.conflictPanel;

  const [oursSelected, setOursSelected] = useState(false);
  const [theirsSelected, setTheirsSelected] = useState(false);

  useEffect(() => {
    setOursSelected(false);
    setTheirsSelected(false);
  }, [file]);

  const bothSelected = oursSelected && theirsSelected;
  const oneSelected = (oursSelected || theirsSelected) && !bothSelected;

  const handleChoose = () => {
    if (oursSelected) {
      postCommand({ type: 'resolveWithOurs', file });
    } else {
      postCommand({ type: 'resolveWithTheirs', file });
    }
    onResolved?.();
  };

  const oursLabel = mergeState.targetBranch || loc.mergeEditor.ours;
  const theirsLabel = mergeState.sourceBranch || loc.mergeEditor.theirs;

  return (
    <div className={s.conflictPanel}>
      <div className={s.cpHeader}>
        <span className={s.cpIcon}>⚠</span>
        <div className={s.cpHeaderText}>
          <h3 className={s.cpTitle}>{cp.title}</h3>
          <p className={s.cpSubtitle}>{cp.subtitle}</p>
        </div>
      </div>

      <div className={s.cpFileName}>{file}</div>

      <div className={s.cpCards}>
        <div
          className={`${s.cpCard} ${oursSelected ? s.cpCardOursActive : s.cpCardIdle}`}
          onClick={() => setOursSelected(v => !v)}
        >
          <div className={s.cpCardBadge}>
            <span className={s.cpBranchIcon}>⑂</span>
            <span className={s.cpCardBranch}>{oursLabel}</span>
            <span className={s.cpCardTag}>{cp.current}</span>
          </div>
        </div>

        <div className={s.cpVs}>vs</div>

        <div
          className={`${s.cpCard} ${theirsSelected ? s.cpCardTheirsActive : s.cpCardIdle}`}
          onClick={() => setTheirsSelected(v => !v)}
        >
          <div className={s.cpCardBadge}>
            <span className={s.cpBranchIcon}>⑂</span>
            <span className={s.cpCardBranch}>{theirsLabel}</span>
            <span className={s.cpCardTag}>{cp.incoming}</span>
          </div>
        </div>
      </div>

      {oneSelected && (
        <button className={s.cpActionBtn} onClick={handleChoose}>
          {cp.choose} {oursSelected ? oursLabel : theirsLabel}
        </button>
      )}

      {bothSelected && (
        <button className={s.cpActionBtn} onClick={() => onOpenEditor(file)}>
          {cp.mergeManually}
        </button>
      )}
    </div>
  );
}
