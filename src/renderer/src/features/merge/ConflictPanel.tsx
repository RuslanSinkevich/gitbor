import { useState, useEffect, useCallback } from 'react';
import { postCommand, onMainEvent } from '../../api';
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
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    setOursSelected(false);
    setTheirsSelected(false);
    setResolving(false);
  }, [file]);

  useEffect(() => {
    if (!resolving) return;
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'mergeState') {
        setResolving(false);
        unsub();
        onResolved?.();
      }
    });
    return unsub;
  }, [resolving, onResolved]);

  const bothSelected = oursSelected && theirsSelected;
  const oneSelected = (oursSelected || theirsSelected) && !bothSelected;
  const conflictInfo = mergeState.conflictFiles.find(f => f.path === file);
  const oursDeleted = conflictInfo?.oursModified === false;
  const theirsDeleted = conflictInfo?.theirsModified === false;
  const canMergeManually = !oursDeleted && !theirsDeleted;

  const handleChoose = useCallback(() => {
    if (resolving) return;
    setResolving(true);
    if (oursSelected) {
      postCommand({ type: 'resolveWithOurs', file });
    } else {
      postCommand({ type: 'resolveWithTheirs', file });
    }
  }, [file, oursSelected, resolving]);

  const oursLabel = mergeState.targetBranch || loc.mergeEditor.ours;
  const theirsLabel = mergeState.sourceBranch || loc.mergeEditor.theirs;
  const actionLabel = oursSelected && oursDeleted
    ? cp.deleteFile
    : theirsSelected && theirsDeleted
      ? cp.deleteFile
      : `${cp.choose} ${oursSelected ? oursLabel : theirsLabel}`;

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
            <span className={`${s.cpChangeTag} ${oursDeleted ? s.cpChangeDeleted : s.cpChangeModified}`}>
              {oursDeleted ? cp.deleted : cp.modified}
            </span>
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
            <span className={`${s.cpChangeTag} ${theirsDeleted ? s.cpChangeDeleted : s.cpChangeModified}`}>
              {theirsDeleted ? cp.deleted : cp.modified}
            </span>
            <span className={s.cpCardTag}>{cp.incoming}</span>
          </div>
        </div>
      </div>

      {oneSelected && (
        <button className={s.cpActionBtn} onClick={handleChoose} disabled={resolving}>
          {resolving ? '...' : actionLabel}
        </button>
      )}

      {bothSelected && canMergeManually && (
        <button className={s.cpActionBtn} onClick={() => onOpenEditor(file)}>
          {cp.mergeManually}
        </button>
      )}

      {bothSelected && !canMergeManually && (
        <button className={s.cpActionBtn} disabled>
          {cp.selectSingleSide}
        </button>
      )}
    </div>
  );
}
