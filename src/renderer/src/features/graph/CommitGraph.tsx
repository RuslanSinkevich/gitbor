import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { t } from '../../i18n';
import type { Commit, GraphNode, MergeLink } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { ROW_HEIGHT, COL_WIDTH, LEFT_PAD, NODE_RADIUS, MERGE_RADIUS, OVERSCAN, DESC_PAD, colX, rowY, formatCommitDate } from './graphConstants';
import { getCommitMenuItems, type ShowPrompt, type OnRebase } from './commitMenuItems';
import { groupBranchPaths, getNodeCircles, getMergeLinkPaths } from './branchPaths';
import s from './CommitGraph.module.css';

interface Props {
  commits: Commit[];
  graphNodes: GraphNode[];
  maxColumns: number;
  mergeLinks: MergeLink[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  currentBranch: string;
  onContextMenu: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
  showPrompt: ShowPrompt;
  onRebase?: OnRebase;
  onLoadMore?: () => void;
}

export function CommitGraph({ commits, graphNodes, maxColumns, mergeLinks, selectedHash, onSelect, currentBranch, onContextMenu, showPrompt, onRebase, onLoadMore }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const loc = t();
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);

  const graphWidth = LEFT_PAD * 2 + (maxColumns + 1) * COL_WIDTH + 12;
  const totalHeight = commits.length * ROW_HEIGHT;

  const updateVisibleRange = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewHeight = el.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(commits.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);
    setVisibleRange(prev => (prev.start === start && prev.end === end) ? prev : { start, end });
  }, [commits.length]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    updateVisibleRange();
    el.addEventListener('scroll', updateVisibleRange, { passive: true });
    return () => el.removeEventListener('scroll', updateVisibleRange);
  }, [updateVisibleRange]);

  const isHead = useCallback((commit: Commit) => commit.refs.some(r => r.type === 'head'), []);

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const matches: number[] = [];
    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      if (c.subject.toLowerCase().includes(q) || c.authorName.toLowerCase().includes(q) || c.hash.toLowerCase().startsWith(q)) {
        matches.push(i);
      }
    }
    return matches;
  }, [commits, searchQuery]);

  const scrollToRow = useCallback((row: number) => {
    const el = bodyRef.current;
    if (!el) return;
    const targetY = row * ROW_HEIGHT - el.clientHeight / 2 + ROW_HEIGHT / 2;
    el.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
  }, []);

  const hashMatch = useCallback((full: string, sel: string | null) => {
    if (!sel) return false;
    return full === sel || full.startsWith(sel) || sel.startsWith(full);
  }, []);

  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedHash && selectedHash !== prevSelectedRef.current) {
      const idx = commits.findIndex(c => hashMatch(c.hash, selectedHash));
      if (idx >= 0) {
        scrollToRow(idx);
      } else if (onLoadMore) {
        onLoadMore();
      }
    }
    prevSelectedRef.current = selectedHash;
  }, [selectedHash, commits, scrollToRow, hashMatch, onLoadMore]);

  const navigateSearch = useCallback((dir: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const next = (searchMatchIdx + dir + searchMatches.length) % searchMatches.length;
    setSearchMatchIdx(next);
    const row = searchMatches[next];
    onSelect(commits[row].hash);
    scrollToRow(row);
  }, [searchMatches, searchMatchIdx, commits, onSelect, scrollToRow]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchVisible(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && searchVisible) {
        setSearchVisible(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchVisible]);

  useEffect(() => {
    setSearchMatchIdx(0);
  }, [searchQuery]);

  const searchMatchSet = useMemo(() => new Set(searchMatches), [searchMatches]);

  const allBranchPaths = useMemo(() => groupBranchPaths(graphNodes), [graphNodes]);
  const allMergePaths = useMemo(() => getMergeLinkPaths(mergeLinks), [mergeLinks]);
  const allNodeCircles = useMemo(() => getNodeCircles(graphNodes, commits), [graphNodes, commits]);

  const bgColor = useMemo(() => {
    if (typeof document === 'undefined') return '#1e1e1e';
    return getComputedStyle(document.body).getPropertyValue('--sg-background').trim() || '#1e1e1e';
  }, []);

  const rowMeta = useMemo(() => {
    const meta = new Array<{ rightEdge: number; color: string }>(commits.length);
    for (let i = 0; i < commits.length; i++) meta[i] = { rightEdge: 0, color: '#888' };
    for (const node of graphNodes) {
      let maxCol = node.column;
      for (const conn of node.connections) {
        if (conn.fromCol > maxCol) maxCol = conn.fromCol;
        if (conn.toCol > maxCol) maxCol = conn.toCol;
      }
      meta[node.commitIndex] = { rightEdge: maxCol, color: node.color };
    }
    return meta;
  }, [graphNodes, commits.length]);

  const svgTop = visibleRange.start * ROW_HEIGHT;
  const svgBottom = visibleRange.end * ROW_HEIGHT;
  const svgHeight = svgBottom - svgTop;
  const margin = ROW_HEIGHT * 2;

  const visiblePaths = useMemo(() => {
    const branches = allBranchPaths.filter(bp => bp.maxY >= svgTop - margin && bp.minY <= svgBottom + margin);
    const merges = allMergePaths.filter(bp => bp.maxY >= svgTop - margin && bp.minY <= svgBottom + margin);
    return { branches, merges };
  }, [allBranchPaths, allMergePaths, svgTop, svgBottom, margin]);

  const visibleCircles = useMemo(() => {
    return allNodeCircles.filter(nc => nc.cy >= svgTop - margin && nc.cy <= svgBottom + margin);
  }, [allNodeCircles, svgTop, svgBottom, margin]);

  const visibleCommits = commits.slice(visibleRange.start, visibleRange.end);

  return (
    <div className={s.root}>
      {searchVisible && (
        <div className={s.searchBar}>
          <input
            ref={searchRef}
            className={s.searchInput}
            type="text"
            placeholder="Search commits..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') navigateSearch(e.shiftKey ? -1 : 1);
              if (e.key === 'Escape') { setSearchVisible(false); setSearchQuery(''); }
            }}
          />
          {searchQuery && (
            <span className={s.searchCount}>
              {searchMatches.length > 0 ? `${searchMatchIdx + 1}/${searchMatches.length}` : 'No results'}
            </span>
          )}
          <button className={s.searchNav} onClick={() => navigateSearch(-1)} disabled={searchMatches.length === 0}>▲</button>
          <button className={s.searchNav} onClick={() => navigateSearch(1)} disabled={searchMatches.length === 0}>▼</button>
          <button className={s.searchClose} onClick={() => { setSearchVisible(false); setSearchQuery(''); }}>✕</button>
        </div>
      )}
      <div className={s.header}>
        <div className={s.colDesc} style={{ paddingLeft: graphWidth }}>{loc.graph.description}</div>
        <div className={s.colAuthor}>{loc.graph.author}</div>
        <div className={s.colDate}>{loc.graph.date}</div>
        <div className={s.colHash}>{loc.graph.sha}</div>
      </div>
      <div className={s.body} ref={bodyRef}>
        <div className={s.scroll} style={{ height: totalHeight }}>
          <svg
            className={s.graphSvg}
            width={graphWidth}
            height={svgHeight}
            style={{ width: graphWidth, top: svgTop, position: 'absolute', left: 0 }}
            viewBox={`0 ${svgTop} ${graphWidth} ${svgHeight}`}
          >
            {visiblePaths.branches.map((bp, i) => (
              <path
                key={i}
                d={bp.d}
                stroke={bp.color}
                strokeWidth={bp.lineWidth}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {visiblePaths.merges.map((bp, i) => (
              <path
                key={`m${i}`}
                d={bp.d}
                stroke={bp.color}
                strokeWidth={bp.lineWidth}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {visibleCircles.map((nc, i) => (
              nc.isMerge ? (
                <polygon
                  key={`n${i}`}
                  points={`${nc.cx},${nc.cy - MERGE_RADIUS} ${nc.cx + MERGE_RADIUS},${nc.cy} ${nc.cx},${nc.cy + MERGE_RADIUS} ${nc.cx - MERGE_RADIUS},${nc.cy}`}
                  fill={nc.color}
                  stroke={bgColor}
                  strokeWidth={2}
                />
              ) : (
                <circle
                  key={`n${i}`}
                  cx={nc.cx}
                  cy={nc.cy}
                  r={NODE_RADIUS}
                  fill={nc.color}
                  stroke={bgColor}
                  strokeWidth={2}
                />
              )
            ))}
          </svg>
          {visibleCommits.map((commit, vi) => {
            const i = visibleRange.start + vi;
            const { rightEdge, color: nodeColor } = rowMeta[i];
            const descLeft = Math.min(colX(rightEdge) + DESC_PAD, graphWidth);
            return (
              <div
                key={commit.hash}
                className={`${s.row} ${hashMatch(commit.hash, selectedHash) ? s.rowSelected : ''} ${isHead(commit) ? s.rowHead : ''} ${searchMatchSet.has(i) ? s.rowSearchMatch : ''}`}
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                onClick={() => onSelect(commit.hash)}
                onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getCommitMenuItems(commit, currentBranch, showPrompt, onRebase)); }}
              >
                <div className={s.rowDesc} style={{ paddingLeft: descLeft }}>
                  {commit.refs.map((ref) => (
                    <span key={ref.name} className={s.refBadge} style={{ background: nodeColor, color: '#fff', borderColor: nodeColor }}>{ref.name}</span>
                  ))}
                  <span className={s.subject}>{commit.subject}</span>
                </div>
                <div className={s.rowAuthor}>{commit.authorName}</div>
                <div className={s.rowDate}>{formatCommitDate(commit.authorDate)}</div>
                <div className={s.rowHash}>{commit.hash.substring(0, 7)}</div>
              </div>
            );
          })}
          {onLoadMore && commits.length >= 500 && (
            <div className={s.loadMore} style={{ top: commits.length * ROW_HEIGHT }}>
              <button className={s.loadMoreBtn} onClick={onLoadMore}>
                Load more commits ({commits.length} loaded)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
