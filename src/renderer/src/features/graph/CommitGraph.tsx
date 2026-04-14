import { useRef, useEffect, useCallback, useMemo } from 'react';
import { t, tpl } from '../../i18n';
import type { Commit, GraphNode, MergeLink } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { ROW_HEIGHT, COL_WIDTH, LEFT_PAD, NODE_RADIUS, MERGE_RADIUS, DESC_PAD, colX, formatCommitDate } from './graphConstants';
import { getCommitMenuItems, type ShowPrompt, type OnRebase } from './commitMenuItems';
import { groupBranchPaths, getNodeCircles, getMergeLinkPaths } from './branchPaths';
import { GpgBadge } from './GpgBadge';
import { useVirtualScroll } from './useVirtualScroll';
import { useGraphSearch } from './useGraphSearch';
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
  const loc = t();
  const graphWidth = LEFT_PAD * 2 + (maxColumns + 1) * COL_WIDTH + 12;
  const totalHeight = commits.length * ROW_HEIGHT;

  const { bodyRef, visibleRange, scrollToRow } = useVirtualScroll(commits.length);
  const search = useGraphSearch(commits, onSelect, scrollToRow);

  const hashMatch = useCallback((full: string, sel: string | null) => {
    if (!sel) return false;
    return full === sel || full.startsWith(sel) || sel.startsWith(full);
  }, []);

  const isHead = useCallback((commit: Commit) => commit.refs.some(r => r.type === 'head'), []);

  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedHash && selectedHash !== prevSelectedRef.current) {
      const idx = commits.findIndex(c => hashMatch(c.hash, selectedHash));
      if (idx >= 0) scrollToRow(idx);
      else if (onLoadMore) onLoadMore();
    }
    prevSelectedRef.current = selectedHash;
  }, [selectedHash, commits, scrollToRow, hashMatch, onLoadMore]);

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

  const visiblePaths = useMemo(() => ({
    branches: allBranchPaths.filter(bp => bp.maxY >= svgTop - margin && bp.minY <= svgBottom + margin),
    merges: allMergePaths.filter(bp => bp.maxY >= svgTop - margin && bp.minY <= svgBottom + margin),
  }), [allBranchPaths, allMergePaths, svgTop, svgBottom, margin]);

  const visibleCircles = useMemo(
    () => allNodeCircles.filter(nc => nc.cy >= svgTop - margin && nc.cy <= svgBottom + margin),
    [allNodeCircles, svgTop, svgBottom, margin],
  );

  const visibleCommits = commits.slice(visibleRange.start, visibleRange.end);

  return (
    <div className={s.root}>
      {search.searchVisible && (
        <div className={s.searchBar}>
          <input ref={search.searchRef} className={s.searchInput} type="text" placeholder={loc.graph.searchPlaceholder}
            value={search.searchQuery} onChange={e => search.setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') search.navigateSearch(e.shiftKey ? -1 : 1);
              if (e.key === 'Escape') { search.setSearchVisible(false); search.setSearchQuery(''); }
            }}
          />
          {search.searchQuery && (
            <span className={s.searchCount}>
              {search.searchMatches.length > 0 ? `${search.searchMatchIdx + 1}/${search.searchMatches.length}` : loc.graph.noSearchResults}
            </span>
          )}
          <button className={s.searchNav} onClick={() => search.navigateSearch(-1)} disabled={search.searchMatches.length === 0}>▲</button>
          <button className={s.searchNav} onClick={() => search.navigateSearch(1)} disabled={search.searchMatches.length === 0}>▼</button>
          <button className={s.searchClose} onClick={() => { search.setSearchVisible(false); search.setSearchQuery(''); }}>✕</button>
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
          <svg className={s.graphSvg} width={graphWidth} height={svgHeight}
            style={{ width: graphWidth, top: svgTop, position: 'absolute', left: 0 }}
            viewBox={`0 ${svgTop} ${graphWidth} ${svgHeight}`}>
            {visiblePaths.branches.map((bp, i) => (
              <path key={i} d={bp.d} stroke={bp.color} strokeWidth={bp.lineWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {visiblePaths.merges.map((bp, i) => (
              <path key={`m${i}`} d={bp.d} stroke={bp.color} strokeWidth={bp.lineWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {visibleCircles.map((nc, i) => (
              nc.isMerge
                ? <polygon key={`n${i}`} points={`${nc.cx},${nc.cy - MERGE_RADIUS} ${nc.cx + MERGE_RADIUS},${nc.cy} ${nc.cx},${nc.cy + MERGE_RADIUS} ${nc.cx - MERGE_RADIUS},${nc.cy}`} fill={nc.color} stroke={bgColor} strokeWidth={2} />
                : <circle key={`n${i}`} cx={nc.cx} cy={nc.cy} r={NODE_RADIUS} fill={nc.color} stroke={bgColor} strokeWidth={2} />
            ))}
          </svg>

          {visibleCommits.map((commit, vi) => {
            const i = visibleRange.start + vi;
            const { rightEdge, color: nodeColor } = rowMeta[i];
            const descLeft = Math.min(colX(rightEdge) + DESC_PAD, graphWidth);
            return (
              <div key={commit.hash}
                className={`${s.row} ${hashMatch(commit.hash, selectedHash) ? s.rowSelected : ''} ${isHead(commit) ? s.rowHead : ''} ${search.searchMatchSet.has(i) ? s.rowSearchMatch : ''}`}
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                onClick={() => onSelect(commit.hash)}
                onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getCommitMenuItems(commit, currentBranch, showPrompt, onRebase)); }}>
                <div className={s.rowDesc} style={{ paddingLeft: descLeft }}>
                  {commit.refs.map((ref) => (
                    <span key={ref.name} className={s.refBadge} style={{ background: nodeColor, color: '#fff', borderColor: nodeColor }}>{ref.name}</span>
                  ))}
                  {commit.gpgStatus && <GpgBadge status={commit.gpgStatus} />}
                  <span className={s.subject}>{commit.subject}</span>
                </div>
                <div className={s.rowAuthor}>{commit.authorName}</div>
                <div className={s.rowDate}>{formatCommitDate(commit.authorDate)}</div>
                <div className={s.rowHash}>{commit.hash.substring(0, 7)}</div>
              </div>
            );
          })}

          {onLoadMore && commits.length > 0 && commits.length % 2000 === 0 && (
            <div className={s.loadMore} style={{ top: commits.length * ROW_HEIGHT }}>
              <button className={s.loadMoreBtn} onClick={onLoadMore}>
                {tpl(loc.graph.loadMore, { loaded: commits.length })}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
