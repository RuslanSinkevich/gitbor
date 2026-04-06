import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { ConflictContent, ConflictBlock, ConflictResolution } from '../../types';
import { postCommand, onMainEvent } from '../../api';
import { t, tpl } from '../../i18n';
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
  const [content, setContent] = useState<ConflictContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolutions, setResolutions] = useState<Map<number, ConflictResolution>>(new Map());
  const [activeConflict, setActiveConflict] = useState(0);
  const [resolving, setResolving] = useState(false);

  const oursBodyRef = useRef<HTMLDivElement>(null);
  const theirsBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setResolutions(new Map());
    setActiveConflict(0);

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'conflictContent' && msg.data.file === file) {
        setContent(msg.data);
        setLoading(false);
      }
    });

    postCommand({ type: 'getConflictContent', file });
    return unsub;
  }, [file]);

  const conflicts = useMemo(() => {
    if (!content) return [];
    const result: { index: number; blockIndex: number; ours: string; theirs: string }[] = [];
    let ci = 0;
    content.blocks.forEach((block, bi) => {
      if (block.type === 'conflict') {
        result.push({ index: ci, blockIndex: bi, ours: block.ours, theirs: block.theirs });
        ci++;
      }
    });
    return result;
  }, [content]);

  const conflictCount = conflicts.length;
  const resolvedCount = resolutions.size;
  const allResolved = resolvedCount === conflictCount && conflictCount > 0;

  const setResolution = useCallback((idx: number, res: ConflictResolution) => {
    setResolutions(prev => {
      const next = new Map(prev);
      next.set(idx, res);
      return next;
    });
  }, []);

  const resolveAll = useCallback((res: ConflictResolution) => {
    setResolutions(() => {
      const next = new Map<number, ConflictResolution>();
      for (let i = 0; i < conflictCount; i++) next.set(i, res);
      return next;
    });
  }, [conflictCount]);

  const navigateConflict = useCallback((dir: -1 | 1) => {
    setActiveConflict(prev => {
      const next = prev + dir;
      if (next < 0) return conflictCount - 1;
      if (next >= conflictCount) return 0;
      return next;
    });
  }, [conflictCount]);

  useEffect(() => {
    if (!content || conflicts.length === 0) return;
    const target = conflicts[activeConflict];
    if (!target) return;
    const scrollToBlock = (container: HTMLDivElement | null, blockIndex: number) => {
      if (!container) return;
      const el = container.querySelector(`[data-block="${blockIndex}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    scrollToBlock(oursBodyRef.current, target.blockIndex);
    scrollToBlock(theirsBodyRef.current, target.blockIndex);
  }, [activeConflict, content, conflicts]);

  useEffect(() => {
    if (!resolving) return;
    const unsub = onMainEvent((msg) => {
      if (msg.type === 'mergeState' || msg.type === 'stateUpdate') {
        setResolving(false);
        onResolved?.();
      }
    });
    return unsub;
  }, [resolving, onResolved]);

  const handleResolve = useCallback(() => {
    if (!content || !allResolved || resolving) return;
    const ordered: ConflictResolution[] = [];
    let ci = 0;
    for (const block of content.blocks) {
      if (block.type === 'conflict') {
        ordered.push(resolutions.get(ci) ?? 'ours');
        ci++;
      }
    }
    setResolving(true);
    postCommand({ type: 'resolveConflict', file, resolutions: ordered });
  }, [content, allResolved, resolutions, file, resolving]);

  const resultPreview = useMemo(() => {
    if (!content) return '';
    const parts: string[] = [];
    let ci = 0;
    for (const block of content.blocks) {
      if (block.type === 'clean') {
        parts.push(block.content);
      } else {
        const res = resolutions.get(ci);
        if (res) {
          switch (res) {
            case 'ours': parts.push(block.ours); break;
            case 'theirs': parts.push(block.theirs); break;
            case 'both-ours-first': parts.push(block.ours + (block.ours && block.theirs ? '\n' : '') + block.theirs); break;
            case 'both-theirs-first': parts.push(block.theirs + (block.ours && block.theirs ? '\n' : '') + block.ours); break;
          }
        } else {
          parts.push(`<<<< ${me.unresolvedBlock} >>>>`);
        }
        ci++;
      }
    }
    return parts.join('\n');
  }, [content, resolutions, me]);

  if (loading) {
    return <div className={s.mergeEditor}><div className={s.mergeLoading}>{me.loading}</div></div>;
  }

  if (!content || !content.hasConflicts) {
    return <div className={s.mergeEditor}><div className={s.mergeLoading}>{me.noConflicts}</div></div>;
  }

  const currentConflict = conflicts[activeConflict];
  const currentRes = currentConflict ? resolutions.get(currentConflict.index) : undefined;

  return (
    <div className={s.mergeEditor}>
      {/* Toolbar */}
      <div className={s.mergeToolbar}>
        <span className={s.mergeToolbarLabel}>{me.merge}</span>
        <span className={s.mergeToolbarFile}>{file}</span>
        <div className={s.mergeToolbarActions}>
          <button className={s.btnGhost} onClick={() => resolveAll('ours')}>{me.acceptAllOurs}</button>
          <button className={s.btnGhost} onClick={() => resolveAll('theirs')}>{me.acceptAllTheirs}</button>
        </div>
      </div>

      {/* Conflict navigation */}
      <div className={s.conflictNav}>
        <div className={s.conflictBadges}>
          {conflicts.map((c, i) => {
            const resolved = resolutions.has(c.index);
            const active = i === activeConflict;
            return (
              <button
                key={c.index}
                className={`${s.conflictBadge} ${resolved ? s.conflictBadgeResolved : s.conflictBadgeUnresolved} ${active ? s.conflictBadgeActive : ''}`}
                onClick={() => setActiveConflict(i)}
              >
                {resolved ? '✓' : '!'} {tpl(me.conflictN, { n: i + 1 })}
              </button>
            );
          })}
        </div>
        <div className={s.conflictNavArrows}>
          <button className={s.btnGhost} onClick={() => navigateConflict(-1)}>◀</button>
          <span className={s.conflictNavLabel}>
            {tpl(me.conflictOf, { current: activeConflict + 1, total: conflictCount })}
          </span>
          <button className={s.btnGhost} onClick={() => navigateConflict(1)}>▶</button>
        </div>
      </div>

      {/* Action buttons for current conflict */}
      <div className={s.conflictActions}>
        <button
          className={`${s.conflictActionBtn} ${s.conflictActionOurs} ${currentRes === 'ours' ? s.conflictActionActive : ''}`}
          onClick={() => currentConflict && setResolution(currentConflict.index, 'ours')}
        >
          {me.acceptOurs}
        </button>
        <button
          className={`${s.conflictActionBtn} ${s.conflictActionTheirs} ${currentRes === 'theirs' ? s.conflictActionActive : ''}`}
          onClick={() => currentConflict && setResolution(currentConflict.index, 'theirs')}
        >
          {me.acceptTheirs}
        </button>
        <button
          className={`${s.conflictActionBtn} ${s.conflictActionBoth} ${currentRes === 'both-ours-first' ? s.conflictActionActive : ''}`}
          onClick={() => currentConflict && setResolution(currentConflict.index, 'both-ours-first')}
        >
          {me.acceptBothOursFirst}
        </button>
        <button
          className={`${s.conflictActionBtn} ${s.conflictActionBoth} ${currentRes === 'both-theirs-first' ? s.conflictActionActive : ''}`}
          onClick={() => currentConflict && setResolution(currentConflict.index, 'both-theirs-first')}
        >
          {me.acceptBothTheirsFirst}
        </button>
      </div>

      {/* Three-pane area */}
      <div className={s.mergePanes}>
        {/* Ours */}
        <div className={s.mergeCol}>
          <div className={`${s.mergeColHeader} ${s.mergeColHeaderOurs}`}>
            <span className={s.mergeColBranch}>{targetBranch || me.ours}</span>
          </div>
          <div className={s.mergeColBody} ref={oursBodyRef}>
            <BlockRenderer
              blocks={content.blocks}
              side="ours"
              resolutions={resolutions}
              activeConflictIndex={activeConflict}
              conflicts={conflicts}
              onClickConflict={(ci) => setActiveConflict(ci)}
            />
          </div>
        </div>

        {/* Theirs */}
        <div className={s.mergeCol}>
          <div className={`${s.mergeColHeader} ${s.mergeColHeaderTheirs}`}>
            <span className={s.mergeColBranch}>{sourceBranch || me.theirs}</span>
          </div>
          <div className={s.mergeColBody} ref={theirsBodyRef}>
            <BlockRenderer
              blocks={content.blocks}
              side="theirs"
              resolutions={resolutions}
              activeConflictIndex={activeConflict}
              conflicts={conflicts}
              onClickConflict={(ci) => setActiveConflict(ci)}
            />
          </div>
        </div>

        {/* Result preview */}
        <div className={s.mergeCol}>
          <div className={`${s.mergeColHeader} ${s.mergeColHeaderResult}`}>
            <span className={s.mergeColBranch}>{me.result}</span>
          </div>
          <div className={s.mergeColBody}>
            <ResultRenderer content={resultPreview} blocks={content.blocks} resolutions={resolutions} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className={s.mergeFooter}>
        <span className={s.mergeFooterStatus}>
          {tpl(me.conflictsResolved, { resolved: resolvedCount, total: conflictCount })}
        </span>
        <button className={s.btnSecondary} onClick={onCancel}>
          {me.cancel}
        </button>
        <button className={s.btnPrimary} onClick={handleResolve} disabled={!allResolved || resolving}>
          {resolving ? me.resolving : me.resolve}
        </button>
      </div>
    </div>
  );
}

/* ─── Block renderer for ours/theirs columns ─── */

interface BlockRendererProps {
  blocks: ConflictBlock[];
  side: 'ours' | 'theirs';
  resolutions: Map<number, ConflictResolution>;
  activeConflictIndex: number;
  conflicts: { index: number; blockIndex: number }[];
  onClickConflict: (conflictListIndex: number) => void;
}

function BlockRenderer({ blocks, side, resolutions, activeConflictIndex, conflicts, onClickConflict }: BlockRendererProps) {
  let conflictIdx = 0;
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
                  <span className={s.mergeLineNo}>{startLine + li}</span>
                  {line}
                </div>
              ))}
            </div>
          );
        }

        const ci = conflictIdx++;
        const listIdx = conflicts.findIndex(c => c.index === ci);
        const text = side === 'ours' ? block.ours : block.theirs;
        const lines = text ? text.split('\n') : [];
        const isActive = listIdx === activeConflictIndex;
        const res = resolutions.get(ci);
        const isChosen = res === side || res === 'both-ours-first' || res === 'both-theirs-first';

        const blockCls = [
          s.mergeBlock,
          s.mergeBlockConflict,
          side === 'ours' ? s.mergeBlockOurs : s.mergeBlockTheirs,
          isActive ? s.mergeBlockActive : '',
          isChosen ? s.mergeBlockChosen : '',
        ].filter(Boolean).join(' ');

        return (
          <div key={bi} className={blockCls} data-block={bi} onClick={() => onClickConflict(listIdx)}>
            {res && (
              <span className={s.mergeBlockLabel}>
                {res === side ? '✓' : res.startsWith('both') ? '½' : '—'}
              </span>
            )}
            {lines.length > 0 ? lines.map((line, li) => (
              <div key={li} className={s.mergeLine}>
                <span className={s.mergeLineNo}>{li + 1}</span>
                {line || ' '}
              </div>
            )) : (
              <div className={`${s.mergeLine} ${s.mergeLineEmpty}`}>
                <span className={s.mergeLineNo}>~</span>
                {'(empty)'}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ─── Result preview renderer ─── */

interface ResultRendererProps {
  content: string;
  blocks: ConflictBlock[];
  resolutions: Map<number, ConflictResolution>;
}

function ResultRenderer({ content, blocks, resolutions }: ResultRendererProps) {
  const lines = content.split('\n');
  let lineNo = 1;

  const conflictLineRanges: { start: number; end: number; resolved: boolean }[] = [];
  let currentLine = 1;
  let ci = 0;
  for (const block of blocks) {
    if (block.type === 'clean') {
      const count = block.content.split('\n').length;
      currentLine += count;
    } else {
      const res = resolutions.get(ci);
      let text = '';
      if (res) {
        switch (res) {
          case 'ours': text = block.ours; break;
          case 'theirs': text = block.theirs; break;
          case 'both-ours-first': text = block.ours + (block.ours && block.theirs ? '\n' : '') + block.theirs; break;
          case 'both-theirs-first': text = block.theirs + (block.ours && block.theirs ? '\n' : '') + block.ours; break;
        }
      } else {
        text = `<<<< unresolved >>>>`;
      }
      const count = text.split('\n').length;
      conflictLineRanges.push({ start: currentLine, end: currentLine + count - 1, resolved: !!res });
      currentLine += count;
      ci++;
    }
  }

  const isConflictLine = (ln: number) => {
    for (const r of conflictLineRanges) {
      if (ln >= r.start && ln <= r.end) return r;
    }
    return null;
  };

  return (
    <>
      <div className={s.mergeBlock}>
        {lines.map((line, li) => {
          const ln = li + 1;
          const range = isConflictLine(ln);
          const cls = range
            ? range.resolved ? s.mergeLineResolved : s.mergeLineUnresolved
            : '';
          return (
            <div key={li} className={`${s.mergeLine} ${cls}`}>
              <span className={s.mergeLineNo}>{ln}</span>
              {line}
            </div>
          );
        })}
      </div>
    </>
  );
}
