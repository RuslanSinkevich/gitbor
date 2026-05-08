import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { ConflictContent } from '../../types';
import { postCommand, onMainEvent } from '../../api';
import { t } from '../../i18n';

type LineKey = string;

function mkKey(bi: number, side: 'ours' | 'theirs', li: number): LineKey {
  return `${bi}:${side}:${li}`;
}

export { mkKey, type LineKey };

interface ConflictEntry { index: number; blockIndex: number }

export function useConflictResolution(file: string, onResolved?: () => void) {
  const me = t().mergeEditor;
  const [content, setContent] = useState<ConflictContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [selectionOrder, setSelectionOrder] = useState<LineKey[]>([]);
  const [activeConflict, setActiveConflict] = useState(0);
  const selected = useMemo(() => new Set(selectionOrder), [selectionOrder]);

  const oursRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setSelectionOrder([]);
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

  const conflicts = useMemo<ConflictEntry[]>(() => {
    if (!content) return [];
    const result: ConflictEntry[] = [];
    let ci = 0;
    content.blocks.forEach((block, bi) => {
      if (block.type === 'conflict') { result.push({ index: ci, blockIndex: bi }); ci++; }
    });
    return result;
  }, [content]);

  const conflictCount = conflicts.length;

  const resolvedConflicts = useMemo(() => {
    if (!content) return 0;
    let count = 0;
    content.blocks.forEach((block, bi) => {
      if (block.type !== 'conflict') return;
      const oursLines = (block.ours || '').split('\n');
      const theirsLines = (block.theirs || '').split('\n');
      const hasOurs = oursLines.some((_, li) => selected.has(mkKey(bi, 'ours', li)));
      const hasTheirs = theirsLines.some((_, li) => selected.has(mkKey(bi, 'theirs', li)));
      if (hasOurs || hasTheirs) count++;
    });
    return count;
  }, [content, selected]);

  const allResolved = resolvedConflicts === conflictCount && conflictCount > 0;

  const toggleLine = useCallback((key: LineKey) => {
    setSelectionOrder(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }, []);

  const toggleBlock = useCallback((bi: number, side: 'ours' | 'theirs', lineCount: number) => {
    setSelectionOrder(prev => {
      const keys = Array.from({ length: lineCount }, (_, li) => mkKey(bi, side, li));
      const prevSet = new Set(prev);
      const allIn = keys.every(k => prevSet.has(k));
      if (allIn) { const removeSet = new Set(keys); return prev.filter(k => !removeSet.has(k)); }
      return [...prev, ...keys.filter(k => !prevSet.has(k))];
    });
  }, []);

  const userNavigated = useRef(false);

  const navigateConflict = useCallback((dir: -1 | 1) => {
    userNavigated.current = true;
    setActiveConflict(prev => {
      const next = prev + dir;
      if (next < 0) return conflictCount - 1;
      if (next >= conflictCount) return 0;
      return next;
    });
  }, [conflictCount]);

  const setActiveConflictManual = useCallback((idx: number) => {
    userNavigated.current = true;
    setActiveConflict(idx);
  }, []);

  useEffect(() => {
    if (!userNavigated.current) return;
    if (!content || conflicts.length === 0) return;
    const target = conflicts[activeConflict];
    if (!target) return;
    const scroll = (container: HTMLDivElement | null, bi: number) => {
      if (!container) return;
      const el = container.querySelector(`[data-block="${bi}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    scroll(oursRef.current, target.blockIndex);
    scroll(theirsRef.current, target.blockIndex);
    userNavigated.current = false;
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

  const lineTextMap = useMemo(() => {
    if (!content) return new Map<LineKey, { text: string; source: 'ours' | 'theirs' }>();
    const map = new Map<LineKey, { text: string; source: 'ours' | 'theirs' }>();
    content.blocks.forEach((block, bi) => {
      if (block.type !== 'conflict') return;
      (block.ours ? block.ours.split('\n') : []).forEach((text, li) => map.set(mkKey(bi, 'ours', li), { text, source: 'ours' }));
      (block.theirs ? block.theirs.split('\n') : []).forEach((text, li) => map.set(mkKey(bi, 'theirs', li), { text, source: 'theirs' }));
    });
    return map;
  }, [content]);

  const resultLines = useMemo(() => {
    if (!content) return [];
    const lines: { text: string; source: 'clean' | 'ours' | 'theirs' }[] = [];
    const selectedByBlock = new Map<number, LineKey[]>();
    for (const key of selectionOrder) {
      const bi = parseInt(key.split(':')[0], 10);
      if (!selectedByBlock.has(bi)) selectedByBlock.set(bi, []);
      selectedByBlock.get(bi)!.push(key);
    }
    for (let bi = 0; bi < content.blocks.length; bi++) {
      const block = content.blocks[bi];
      if (block.type === 'clean') {
        for (const line of block.content.split('\n')) lines.push({ text: line, source: 'clean' });
      } else {
        const blockKeys = selectedByBlock.get(bi);
        if (blockKeys && blockKeys.length > 0) {
          for (const key of blockKeys) { const entry = lineTextMap.get(key); if (entry) lines.push(entry); }
        } else {
          lines.push({ text: `<<<< ${me.unresolvedBlock} >>>>`, source: 'clean' });
        }
      }
    }
    return lines;
  }, [content, selectionOrder, lineTextMap, me]);

  const handleResolve = useCallback(() => {
    if (!content || !allResolved || resolving) return;
    const finalContent = resultLines.map(l => l.text).join('\n');
    setResolving(true);
    postCommand({ type: 'resolveConflictRaw', file, content: finalContent });
  }, [content, allResolved, resultLines, file, resolving]);

  return {
    content, loading, resolving, selected, activeConflict, setActiveConflict: setActiveConflictManual,
    conflicts, conflictCount, resolvedConflicts, allResolved,
    toggleLine, toggleBlock, navigateConflict, handleResolve, resultLines,
    oursRef, theirsRef,
  };
}
