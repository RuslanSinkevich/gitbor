import { memo, useRef, useEffect, useCallback, useMemo, type KeyboardEvent as ReactKBEvent } from 'react';
import { t } from '../../i18n';
import type { Commit, GraphNode, MergeLink } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { ROW_HEIGHT, COL_WIDTH, LEFT_PAD, NODE_RADIUS, MERGE_RADIUS, DESC_PAD, colX, rowY, formatCommitDate } from './graphConstants';
import { getCommitMenuItems, type ShowPrompt, type OnRebase } from './commitMenuItems';
import type { RequestCheckout } from '../checkout';
import { groupBranchPaths, getNodeCircles, getMergeLinkPaths, type BranchPathData, type NodeCircle } from './branchPaths';
import { buildRefBadges } from './refBadges';
import { GpgBadge } from './GpgBadge';
import { useVirtualScroll } from './useVirtualScroll';
import { useGraphSearch } from './useGraphSearch';
import { AuthorAvatar } from '../../ui/AuthorAvatar';
import s from './CommitGraph.module.css';

/**
 * Мульти-entry кэш по identity массива nodes/commits. useMemo в React хранит
 * только одно последнее значение — при цикле "большой → маленький → большой"
 * он каждый раз пересчитывает groupBranchPaths(15k) = 100-150мс. WeakMap по
 * ссылке даёт O(1) выдачу и сам чистит память, когда репо закрыт.
 */
const branchPathsByNodes = new WeakMap<GraphNode[], BranchPathData[]>();
const nodeCirclesByNodes = new WeakMap<GraphNode[], NodeCircle[]>();
const rowMetaByNodes = new WeakMap<GraphNode[], { rightEdge: number; color: string; isRemoteOnly: boolean }[]>();

function getOrComputeBranchPaths(nodes: GraphNode[]): BranchPathData[] {
  const cached = branchPathsByNodes.get(nodes);
  if (cached) return cached;
  const result = groupBranchPaths(nodes);
  branchPathsByNodes.set(nodes, result);
  return result;
}

function getOrComputeNodeCircles(nodes: GraphNode[], commits: Commit[]): NodeCircle[] {
  const cached = nodeCirclesByNodes.get(nodes);
  if (cached) return cached;
  const result = getNodeCircles(nodes, commits);
  nodeCirclesByNodes.set(nodes, result);
  return result;
}

function getOrComputeRowMeta(nodes: GraphNode[], commitsLen: number): { rightEdge: number; color: string; isRemoteOnly: boolean }[] {
  const cached = rowMetaByNodes.get(nodes);
  if (cached) return cached;
  const meta = new Array<{ rightEdge: number; color: string; isRemoteOnly: boolean }>(commitsLen);
  for (let i = 0; i < commitsLen; i++) meta[i] = { rightEdge: 0, color: '#888', isRemoteOnly: false };
  for (const node of nodes) {
    let maxCol = node.column;
    for (const conn of node.connections) {
      if (conn.fromCol > maxCol) maxCol = conn.fromCol;
      if (conn.toCol > maxCol) maxCol = conn.toCol;
    }
    meta[node.commitIndex] = { rightEdge: maxCol, color: node.color, isRemoteOnly: node.isRemoteOnly === true };
  }
  rowMetaByNodes.set(nodes, meta);
  return meta;
}

interface Props {
  commits: Commit[];
  graphNodes: GraphNode[];
  maxColumns: number;
  mergeLinks: MergeLink[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  currentBranch: string;
  /** Имена remote'ов — для слияния локальной ветки с её remote-tracking двойником. */
  remoteNames: string[];
  /**
   * Идентификатор репо/таба — используется как scope-ключ для запоминания
   * scrollTop отдельно для каждого открытого репо, чтобы переключение
   * туда-обратно возвращало юзера в ту же точку графа.
   */
  repoPath?: string;
  onContextMenu: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
  showPrompt: ShowPrompt;
  requestCheckout: RequestCheckout;
  onRebase?: OnRebase;
  onLoadMore?: () => void;
  compareFrom?: string | null;
  onCompareFrom?: (hash: string) => void;
  onCompareTo?: (from: string, to: string) => void;
  /** HEAD совпадает с upstream (ahead === 0) — uncommit запрещён. */
  headOnRemote?: boolean;
  /**
   * Счётчик «запроса фокуса»: инкрементится на каждый клик по ветке (даже по
   * уже выбранной). Меняется → доскроллить к `selectedHash`, даже если сам
   * hash не изменился. Без него повторный клик по той же ветке после прокрутки
   * графа не давал реакции (selectedHash тот же → эффект ниже не срабатывал).
   */
  focusNonce?: number;
}

function CommitGraphImpl({ commits, graphNodes, maxColumns, mergeLinks, selectedHash, onSelect, currentBranch, remoteNames, repoPath, onContextMenu, showPrompt, requestCheckout, onRebase, onLoadMore, compareFrom, onCompareFrom, onCompareTo, headOnRemote = false, focusNonce }: Props) {
  const loc = t();
  const graphWidth = LEFT_PAD * 2 + (maxColumns + 1) * COL_WIDTH + 12;
  const totalHeight = commits.length * ROW_HEIGHT;

  /*
   * Заголовок «Описание» и левый отступ subject'ов позиционируются по ширине
   * графа. Во время операций (fetch/merge/rebase) graphLayout обновляется
   * несколькими промежуточными событиями, и maxColumns кратковременно скачет
   * (большой → маленький → большой). Из-за этого подпись «Описание» дёргалась
   * влево-вправо. Держим «high-water mark» ширины в пределах одного репо:
   * значение только растёт, поэтому подпись не дрожит при просадках. При смене
   * репо (repoPath) сбрасываем, чтобы узкий граф не наследовал ширину широкого.
   * Мутация ref во время рендера безопасна — это чистый кэш по repoPath
   * (тот же приём, что и WeakMap-кэши выше).
   */
  const stableWidthRef = useRef<{ repo: string | undefined; width: number }>({ repo: repoPath, width: graphWidth });
  if (stableWidthRef.current.repo !== repoPath) {
    stableWidthRef.current = { repo: repoPath, width: graphWidth };
  } else if (graphWidth > stableWidthRef.current.width) {
    stableWidthRef.current.width = graphWidth;
  }
  const stableGraphWidth = stableWidthRef.current.width;

  const { bodyRef, visibleRange, scrollToRow } = useVirtualScroll(commits.length, repoPath ?? '__default__');
  const search = useGraphSearch(commits, onSelect, scrollToRow);

  const hashMatch = useCallback((full: string, sel: string | null) => {
    if (!sel) return false;
    return full === sel || full.startsWith(sel) || sel.startsWith(full);
  }, []);

  const isHead = useCallback((commit: Commit) => commit.refs.some(r => r.type === 'head'), []);

  const prevSelectedRef = useRef<string | null>(null);
  const prevFocusRef = useRef<number | undefined>(focusNonce);
  useEffect(() => {
    const focusRequested = focusNonce !== prevFocusRef.current;
    prevFocusRef.current = focusNonce;
    // Скроллим при смене выбранного коммита ИЛИ при явном запросе фокуса
    // (повторный клик по той же ветке). Простая смена commits (fetch/refresh)
    // при том же selectedHash и без focus-запроса скролл не дёргает.
    if (selectedHash && (selectedHash !== prevSelectedRef.current || focusRequested)) {
      const idx = commits.findIndex(c => hashMatch(c.hash, selectedHash));
      if (idx >= 0) scrollToRow(idx);
      else if (onLoadMore) onLoadMore();
    }
    prevSelectedRef.current = selectedHash;
  }, [selectedHash, focusNonce, commits, scrollToRow, hashMatch, onLoadMore]);

  const allBranchPaths = useMemo(() => getOrComputeBranchPaths(graphNodes), [graphNodes]);
  const allMergePaths = useMemo(() => getMergeLinkPaths(mergeLinks), [mergeLinks]);
  const allNodeCircles = useMemo(() => getOrComputeNodeCircles(graphNodes, commits), [graphNodes, commits]);

  const bgColor = useMemo(() => {
    if (typeof document === 'undefined') return '#1e1e1e';
    return getComputedStyle(document.body).getPropertyValue('--sg-background').trim() || '#1e1e1e';
  }, []);

  const rowMeta = useMemo(() => getOrComputeRowMeta(graphNodes, commits.length), [graphNodes, commits.length]);

  /*
   * Активная ветка (HEAD): подсвечиваем её узел в графе кольцом — как в Fork,
   * где сразу видно, где сейчас стоит checkout. Ищем коммит с ref-ом 'head',
   * берём его дорожку из graphNodes.
   */
  const headNode = useMemo(() => {
    const headIdx = commits.findIndex(c => c.refs.some(r => r.type === 'head'));
    if (headIdx < 0) return null;
    const node = graphNodes.find(n => n.commitIndex === headIdx);
    if (!node) return null;
    return { cx: colX(node.column), cy: rowY(headIdx), color: node.color };
  }, [commits, graphNodes]);

  const headRingVisible = headNode != null;

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

  const handleKeyDown = useCallback((e: ReactKBEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const idx = commits.findIndex(c => hashMatch(c.hash, selectedHash));
    if (idx < 0) { if (commits.length) onSelect(commits[0].hash); return; }
    const next = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
    if (next >= 0 && next < commits.length) {
      onSelect(commits[next].hash);
      scrollToRow(next);
    }
  }, [commits, selectedHash, onSelect, scrollToRow, hashMatch]);

  return (
    <div className={s.root} tabIndex={0} onKeyDown={handleKeyDown}>
      {search.searchVisible && (
        <div className={s.searchBar}>
          <input ref={search.searchRef} className={s.searchInput} type="text"
            placeholder={search.aiMode ? loc.aiTier2.semanticSearchPlaceholder : loc.graph.searchPlaceholder}
            value={search.searchQuery} onChange={e => search.setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') search.navigateSearch(e.shiftKey ? -1 : 1);
              if (e.key === 'Escape') { search.setSearchVisible(false); search.setSearchQuery(''); }
            }}
          />
          <button
            type="button"
            className={`${s.searchAiToggle} ${search.aiMode ? s.searchAiToggleActive : ''}`}
            onClick={search.toggleAiMode}
            title={search.aiMode ? loc.aiTier2.semanticSearchOff : loc.aiTier2.semanticSearchOn}
            aria-label={search.aiMode ? loc.aiTier2.semanticSearchOff : loc.aiTier2.semanticSearchOn}
            aria-pressed={search.aiMode}
          >
            <SemanticSearchIcon />
          </button>
          {search.aiMode && search.semantic.status === 'busy' && (
            <span className={s.searchCount}>{loc.aiTier2.semanticSearchBusy}</span>
          )}
          {search.aiMode && search.semantic.status === 'error' && (
            <span className={s.searchCount} title={search.semantic.error}>
              {loc.aiTier2.semanticSearchFailed.replace('{error}', '')}
            </span>
          )}
          {search.searchQuery && !search.aiMode && (
            <span className={s.searchCount}>
              {search.searchMatches.length > 0 ? `${search.searchMatchIdx + 1}/${search.searchMatches.length}` : loc.graph.noSearchResults}
            </span>
          )}
          {search.aiMode && search.semantic.status === 'done' && (
            <span className={s.searchCount}>
              {search.searchMatches.length > 0 ? `${search.searchMatchIdx + 1}/${search.searchMatches.length}` : loc.aiTier2.semanticSearchEmpty}
            </span>
          )}
          <button className={s.searchNav} onClick={() => search.navigateSearch(-1)} disabled={search.searchMatches.length === 0}>▲</button>
          <button className={s.searchNav} onClick={() => search.navigateSearch(1)} disabled={search.searchMatches.length === 0}>▼</button>
          <button className={s.searchClose} onClick={() => { search.setSearchVisible(false); search.setSearchQuery(''); }}>✕</button>
        </div>
      )}

      <div className={s.header}>
        <div className={s.colDesc} style={{ paddingLeft: stableGraphWidth }}>{loc.graph.description}</div>
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
              <path key={i} d={bp.d} stroke={bp.color} strokeWidth={bp.lineWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={bp.dimmed ? 0.35 : 1} />
            ))}
            {visiblePaths.merges.map((bp, i) => (
              <path key={`m${i}`} d={bp.d} stroke={bp.color} strokeWidth={bp.lineWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={bp.dimmed ? 0.35 : 1} />
            ))}
            {visibleCircles.map((nc, i) => (
              nc.isMerge
                ? <polygon key={`n${i}`} points={`${nc.cx},${nc.cy - MERGE_RADIUS} ${nc.cx + MERGE_RADIUS},${nc.cy} ${nc.cx},${nc.cy + MERGE_RADIUS} ${nc.cx - MERGE_RADIUS},${nc.cy}`} fill={nc.color} stroke={bgColor} strokeWidth={2} opacity={nc.dimmed ? 0.45 : 1} />
                : <circle key={`n${i}`} cx={nc.cx} cy={nc.cy} r={NODE_RADIUS} fill={nc.color} stroke={bgColor} strokeWidth={2} opacity={nc.dimmed ? 0.45 : 1} />
            ))}
            {headRingVisible && headNode.cy >= svgTop - margin && headNode.cy <= svgBottom + margin && (
              <circle cx={headNode.cx} cy={headNode.cy} r={NODE_RADIUS + 3} fill="none" stroke={headNode.color} strokeWidth={2} opacity={0.95} />
            )}
          </svg>

          {visibleCommits.map((commit, vi) => {
            const i = visibleRange.start + vi;
            const { rightEdge, color: nodeColor, isRemoteOnly } = rowMeta[i];
            const descLeft = Math.min(colX(rightEdge) + DESC_PAD, stableGraphWidth);
            // Контрастная иерархия: коммиты с ref-бейджами (HEAD/branch/tag)
            // выделены чуть более насыщенным subject — это «anchor-коммиты»,
            // у которых есть имя. Остальные рендерятся в стандартной яркости.
            // Раньше попытка дополнительно «приглушать» merge-коммиты без
            // ref'ов давала слишком серый граф (пользователь жаловался).
            const significant = commit.refs.length > 0;
            return (
              <div key={commit.hash}
                className={`${s.row} ${hashMatch(commit.hash, selectedHash) ? s.rowSelected : ''} ${isHead(commit) ? s.rowHead : ''} ${significant ? s.rowSignificant : ''} ${search.searchMatchSet.has(i) ? s.rowSearchMatch : ''} ${isRemoteOnly ? s.rowDimmed : ''}`}
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                onClick={() => onSelect(commit.hash)}
                title={isRemoteOnly ? loc.graph.remoteOnlyHint : undefined}
                onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getCommitMenuItems(commit, currentBranch, showPrompt, requestCheckout, onRebase, compareFrom, onCompareFrom, onCompareTo, headOnRemote)); }}>
                <div className={s.rowDesc} style={{ paddingLeft: descLeft }}>
                  {buildRefBadges(commit.refs, remoteNames, currentBranch).map((badge) => {
                    const tip = badge.isCurrent
                      ? `${badge.fullNames.join('\n')}\n(${loc.graph.currentBranchHint})`
                      : badge.fullNames.join('\n');
                    return (
                      <span
                        key={badge.key}
                        className={`${s.refBadge} ${badge.isCurrent ? s.refBadgeCurrent : ''}`}
                        style={{ background: nodeColor, color: '#fff', borderColor: nodeColor }}
                        title={tip}
                      >
                        <span className={s.refBadgeLabel}>{badge.label}</span>
                        {badge.hasLocal && badge.remotes.length > 0 && (
                          <span className={s.refBadgeSync} title={badge.remotes.join(', ')} aria-hidden="true" />
                        )}
                      </span>
                    );
                  })}
                  {commit.gpgStatus && <GpgBadge status={commit.gpgStatus} />}
                  <span className={s.subject}>{commit.subject}</span>
                </div>
                <div className={s.rowAuthor}>
                  <AuthorAvatar name={commit.authorName} email={commit.authorEmail} size="sm" />
                  <span className={s.rowAuthorName}>{commit.authorName}</span>
                </div>
                <div className={s.rowDate}>{formatCommitDate(commit.authorDate)}</div>
                <div className={s.rowHash}>{commit.hash.substring(0, 7)}</div>
              </div>
            );
          })}

        </div>
      </div>
    </div>
  );
}

/** Иконка-«sparkle» для тумблера AI-поиска. */
function SemanticSearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M8 1.5L9.6 6.4L14.5 8L9.6 9.6L8 14.5L6.4 9.6L1.5 8L6.4 6.4L8 1.5Z" fill="currentColor" />
      <path d="M12.5 11L13.1 12.4L14.5 13L13.1 13.6L12.5 15L11.9 13.6L10.5 13L11.9 12.4L12.5 11Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

/**
 * Мемоизация по identity важных данных. Любой setState в App (branches/tags/
 * operationRunning/...) триггерит ре-рендер CommitGraph, даже если commits и
 * graphNodes — те же ссылки. Reconciliation 50 visibleCommits + SVG-path'ов
 * — это ~15-30мс × N setState'ов подряд после switchRepo. Compare только по
 * данным: коллбэки не влияют на видимый DOM, их closures обновятся на
 * следующем нужном рендере. Если что-то из рендер-критичных пропсов
 * поменялось — мемо отдаст свежую картинку.
 */
export const CommitGraph = memo(CommitGraphImpl, (prev, next) => (
  prev.commits === next.commits &&
  prev.graphNodes === next.graphNodes &&
  prev.maxColumns === next.maxColumns &&
  prev.mergeLinks === next.mergeLinks &&
  prev.selectedHash === next.selectedHash &&
  prev.focusNonce === next.focusNonce &&
  prev.currentBranch === next.currentBranch &&
  prev.remoteNames === next.remoteNames &&
  prev.compareFrom === next.compareFrom &&
  prev.headOnRemote === next.headOnRemote &&
  prev.repoPath === next.repoPath
));
