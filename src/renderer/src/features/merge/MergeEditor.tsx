import type { ConflictBlock } from '../../types';
import { t, tpl } from '../../i18n';
import { useConflictResolution, mkKey, type LineKey } from './useConflictResolution';
import s from './Merge.module.css';

interface Props {
  file: string;
  sourceBranch: string;
  targetBranch: string;
  onResolved?: () => void;
  onCancel?: () => void;
}

export function MergeEditor({ file, sourceBranch, targetBranch, onResolved, onCancel }: Props) {
  const loc = t();
  const me = loc.mergeEditor;
  const cr = useConflictResolution(file, onResolved);

  if (cr.loading) {
    return <ModalShell><div className={s.mergeLoading}>{me.loading}</div></ModalShell>;
  }
  if (!cr.content || !cr.content.hasConflicts) {
    return <ModalShell><div className={s.mergeLoading}>{me.noConflicts}</div></ModalShell>;
  }

  return (
    <div className={s.meOverlay}>
      <div className={s.meModal}>
        <div className={s.mergeToolbar}>
          <span className={s.mergeToolbarLabel}>{me.merge}</span>
          <span className={s.mergeToolbarFile}>{file}</span>
          <div className={s.conflictNavArrows}>
            <button className={s.btnGhost} onClick={() => cr.navigateConflict(-1)}>◀</button>
            <span className={s.conflictNavLabel}>
              {tpl(me.conflictOf, { current: cr.activeConflict + 1, total: cr.conflictCount })}
            </span>
            <button className={s.btnGhost} onClick={() => cr.navigateConflict(1)}>▶</button>
          </div>
        </div>

        <div className={s.mergeTwoCols}>
          <SideColumnPane
            label={targetBranch || me.ours}
            headerCls={s.mergeColHeaderOurs}
            ref={cr.oursRef}
            blocks={cr.content.blocks}
            side="ours"
            selected={cr.selected}
            activeConflict={cr.conflicts[cr.activeConflict]?.blockIndex ?? -1}
            onToggleLine={cr.toggleLine}
            onToggleBlock={cr.toggleBlock}
            onClickConflict={(bi) => {
              const idx = cr.conflicts.findIndex(c => c.blockIndex === bi);
              if (idx >= 0) cr.setActiveConflict(idx);
            }}
          />
          <SideColumnPane
            label={sourceBranch || me.theirs}
            headerCls={s.mergeColHeaderTheirs}
            ref={cr.theirsRef}
            blocks={cr.content.blocks}
            side="theirs"
            selected={cr.selected}
            activeConflict={cr.conflicts[cr.activeConflict]?.blockIndex ?? -1}
            onToggleLine={cr.toggleLine}
            onToggleBlock={cr.toggleBlock}
            onClickConflict={(bi) => {
              const idx = cr.conflicts.findIndex(c => c.blockIndex === bi);
              if (idx >= 0) cr.setActiveConflict(idx);
            }}
          />
        </div>

        <ResultPane
          resultLines={cr.resultLines}
          resolvedConflicts={cr.resolvedConflicts}
          conflictCount={cr.conflictCount}
          allResolved={cr.allResolved}
          resolving={cr.resolving}
          onResolve={cr.handleResolve}
          onCancel={onCancel}
          me={me}
        />
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.meOverlay}>
      <div className={s.meModal}>{children}</div>
    </div>
  );
}

import { forwardRef } from 'react';

interface SideColumnPaneProps {
  label: string;
  headerCls: string;
  blocks: ConflictBlock[];
  side: 'ours' | 'theirs';
  selected: Set<LineKey>;
  activeConflict: number;
  onToggleLine: (key: LineKey) => void;
  onToggleBlock: (bi: number, side: 'ours' | 'theirs', lineCount: number) => void;
  onClickConflict: (bi: number) => void;
}

const SideColumnPane = forwardRef<HTMLDivElement, SideColumnPaneProps>(
  ({ label, headerCls, blocks, side, selected, activeConflict, onToggleLine, onToggleBlock, onClickConflict }, ref) => (
    <div className={s.mergeCol}>
      <div className={`${s.mergeColHeader} ${headerCls}`}>
        <span className={s.mergeColBranch}>{label}</span>
      </div>
      <div className={s.mergeColBody} ref={ref}>
        <SideColumn
          blocks={blocks} side={side} selected={selected}
          activeConflict={activeConflict}
          onToggleLine={onToggleLine} onToggleBlock={onToggleBlock} onClickConflict={onClickConflict}
        />
      </div>
    </div>
  )
);

function SideColumn({ blocks, side, selected, activeConflict, onToggleLine, onToggleBlock, onClickConflict }: {
  blocks: ConflictBlock[]; side: 'ours' | 'theirs'; selected: Set<LineKey>; activeConflict: number;
  onToggleLine: (key: LineKey) => void; onToggleBlock: (bi: number, side: 'ours' | 'theirs', lineCount: number) => void;
  onClickConflict: (bi: number) => void;
}) {
  let lineNo = 1;
  return (
    <>
      {blocks.map((block, bi) => {
        if (block.type === 'clean') {
          const lines = block.content.split('\n');
          const startLine = lineNo;
          lineNo += lines.length;
          return (
            <div key={bi} className={s.mergeBlock} data-block={bi}>
              {lines.map((line, li) => (
                <div key={li} className={s.mergeLine}>
                  <span className={s.mergeLineNo}>{startLine + li}</span>{line}
                </div>
              ))}
            </div>
          );
        }

        const text = side === 'ours' ? block.ours : block.theirs;
        const lines = text ? text.split('\n') : [];
        const isActive = bi === activeConflict;
        const allBlockSelected = lines.length > 0 && lines.every((_, li) => selected.has(mkKey(bi, side, li)));
        const someBlockSelected = lines.some((_, li) => selected.has(mkKey(bi, side, li)));

        const blockCls = [
          s.mergeBlock, s.mergeBlockConflict,
          side === 'ours' ? s.mergeBlockOurs : s.mergeBlockTheirs,
          isActive ? s.mergeBlockActive : '',
        ].filter(Boolean).join(' ');

        const startLine = lineNo;
        lineNo += lines.length || 1;

        return (
          <div key={bi} className={blockCls} data-block={bi} onClick={() => onClickConflict(bi)}>
            <div className={s.mergeCheckbox}>
              <input
                type="checkbox" checked={allBlockSelected}
                ref={(el) => { if (el) el.indeterminate = someBlockSelected && !allBlockSelected; }}
                onChange={(e) => { e.stopPropagation(); onToggleBlock(bi, side, lines.length); }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            {lines.length > 0 ? lines.map((line, li) => {
              const key = mkKey(bi, side, li);
              const isSelected = selected.has(key);
              return (
                <div key={li} className={`${s.mergeLine} ${s.mergeLineSelectable} ${isSelected ? s.mergeLineSelected : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleLine(key); }}>
                  <span className={s.mergeLineNo}>{startLine + li}</span>{line || ' '}
                </div>
              );
            }) : (
              <div className={`${s.mergeLine} ${s.mergeLineEmpty}`}>
                <span className={s.mergeLineNo}>~</span>(empty)
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function ResultPane({ resultLines, resolvedConflicts, conflictCount, allResolved, resolving, onResolve, onCancel, me }: {
  resultLines: { text: string; source: 'clean' | 'ours' | 'theirs' }[];
  resolvedConflicts: number; conflictCount: number; allResolved: boolean; resolving: boolean;
  onResolve: () => void; onCancel?: () => void; me: any;
}) {
  return (
    <>
      <div className={s.mergeResultPane}>
        <div className={s.mergeResultHeader}>
          <span className={s.mergeColBranch}>{me.result}</span>
          <span className={s.mergeResultStatus}>
            {tpl(me.conflictsResolved, { resolved: resolvedConflicts, total: conflictCount })}
          </span>
        </div>
        <div className={s.mergeResultBody}>
          {resultLines.map((rl, i) => (
            <div key={i} className={`${s.mergeLine} ${rl.source === 'ours' ? s.mergeResultLineOurs : rl.source === 'theirs' ? s.mergeResultLineTheirs : ''}`}>
              <span className={s.mergeLineNo}>{i + 1}</span>{rl.text}
            </div>
          ))}
        </div>
      </div>
      <div className={s.mergeFooter}>
        <span className={s.mergeFooterStatus}>
          {allResolved ? me.allResolved : tpl(me.conflictsResolved, { resolved: resolvedConflicts, total: conflictCount })}
        </span>
        <button className={s.btnSecondary} onClick={onCancel}>{me.cancel}</button>
        <button className={s.btnPrimary} onClick={onResolve} disabled={!allResolved || resolving}>
          {resolving ? me.resolving : me.resolve}
        </button>
      </div>
    </>
  );
}
