import { useEffect, useState, useCallback } from 'react';
import type { ConflictContent, ConflictBlock } from '../../types';
import { postCommand, onMainEvent } from '../../api';
import s from './Merge.module.css';

interface Props {
  file: string;
  sourceBranch: string;
  targetBranch: string;
  onResolved?: () => void;
  onCancel?: () => void;
}

export function MergeEditor({ file, sourceBranch, targetBranch, onResolved, onCancel }: Props) {
  const [content, setContent] = useState<ConflictContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolutions, setResolutions] = useState<Map<number, 'ours' | 'theirs'>>(new Map());

  useEffect(() => {
    setLoading(true);
    setResolutions(new Map());

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'conflictContent' && msg.data.file === file) {
        setContent(msg.data);
        setLoading(false);
      }
    });

    postCommand({ type: 'getConflictContent', file });
    return unsub;
  }, [file]);

  const conflictCount = content?.blocks.filter(b => b.type === 'conflict').length ?? 0;
  const resolvedCount = resolutions.size;
  const allResolved = resolvedCount === conflictCount && conflictCount > 0;

  const toggleResolution = useCallback((conflictIdx: number, side: 'ours' | 'theirs') => {
    setResolutions(prev => {
      const next = new Map(prev);
      if (next.get(conflictIdx) === side) {
        next.delete(conflictIdx);
      } else {
        next.set(conflictIdx, side);
      }
      return next;
    });
  }, []);

  const handleResolve = useCallback(() => {
    if (!content || !allResolved) return;
    const ordered: ('ours' | 'theirs')[] = [];
    let ci = 0;
    for (const block of content.blocks) {
      if (block.type === 'conflict') {
        ordered.push(resolutions.get(ci) ?? 'ours');
        ci++;
      }
    }
    postCommand({ type: 'resolveConflict', file, resolutions: ordered });
    onResolved?.();
  }, [content, allResolved, resolutions, file, onResolved]);

  if (loading) {
    return <div className={s.mergeEditor}><div style={{ padding: 24, color: 'var(--sg-foreground-muted)' }}>Loading conflict...</div></div>;
  }

  if (!content || !content.hasConflicts) {
    return <div className={s.mergeEditor}><div style={{ padding: 24, color: 'var(--sg-foreground-muted)' }}>No conflicts in this file</div></div>;
  }

  let conflictIdx = 0;

  return (
    <div className={s.mergeEditor}>
      <div className={s.mergeToolbar}>
        <span>Merge</span>
        <span className={s.mergeToolbarFile}>{file}</span>
      </div>

      <div className={s.mergeColumns}>
        <Column
          label={targetBranch || 'Ours'}
          side="ours"
          blocks={content.blocks}
          resolutions={resolutions}
          onToggle={toggleResolution}
        />
        <Column
          label={sourceBranch || 'Theirs'}
          side="theirs"
          blocks={content.blocks}
          resolutions={resolutions}
          onToggle={toggleResolution}
        />
      </div>

      <div className={s.mergeFooter}>
        <span className={s.mergeFooterStatus}>
          {resolvedCount}/{conflictCount} conflicts resolved
        </span>
        <button className={s.btnPrimary} onClick={handleResolve} disabled={!allResolved}>
          Resolve
        </button>
        <button className={s.btnSecondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Column({ label, side, blocks, resolutions, onToggle }: {
  label: string;
  side: 'ours' | 'theirs';
  blocks: ConflictBlock[];
  resolutions: Map<number, 'ours' | 'theirs'>;
  onToggle: (idx: number, side: 'ours' | 'theirs') => void;
}) {
  let conflictIdx = 0;
  let lineNo = 1;

  return (
    <div className={s.mergeCol}>
      <div className={s.mergeColHeader}>
        <span className={s.mergeColBranch}>{label}</span>
      </div>
      <div className={s.mergeColBody}>
        {blocks.map((block, bi) => {
          if (block.type === 'clean') {
            const lines = block.content.split('\n');
            const startLine = lineNo;
            lineNo += lines.length;
            return (
              <div key={bi} className={s.mergeBlock}>
                {lines.map((line, li) => (
                  <div key={li} className={s.mergeLine}>
                    <span className={s.mergeLineNo}>{startLine + li}</span>
                    {line}
                  </div>
                ))}
              </div>
            );
          }

          const ci = conflictIdx++;
          const text = side === 'ours' ? block.ours : block.theirs;
          const lines = text ? text.split('\n') : ['--- empty ---'];
          const isSelected = resolutions.get(ci) === side;
          const blockCls = `${s.mergeBlock} ${s.mergeBlockConflict} ${
            side === 'ours' ? s.mergeBlockOurs : s.mergeBlockTheirs
          } ${isSelected ? s.mergeBlockSelected : ''}`;

          return (
            <div key={bi} className={blockCls} onClick={() => onToggle(ci, side)}>
              {isSelected && <span className={s.mergeBlockLabel}>selected</span>}
              {lines.map((line, li) => (
                <div key={li} className={s.mergeLine}>
                  <span className={s.mergeLineNo}>{li + 1}</span>
                  {line || ' '}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
