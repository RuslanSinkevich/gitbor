import { useState, useEffect, useMemo } from 'react';
import { CommitGraph, CommitDetails, useMultiSelect } from '../graph';
import { useCommitExplainer } from '../ai';
import { RightPanelContent } from './RightPanelContent';
import { SgSplitPane } from '../../ui/SgSplitPane';
import { postCommand } from '../../api';
import { buildStorageKey } from '../../shared/uiPersist';
import { t, tpl } from '../../i18n';
import { useGraphFilter } from '../../hooks/useGraphFilter';
import type { AppState, CommitDetail } from '../../types';
import type { ShowContextMenuFn } from '../../hooks/useContextMenu';
import type { ShowPromptFn } from '../../ui/SgPromptDialog';
import type { RequestCheckout } from '../checkout';
import s from '../../App.module.css';

interface Props {
  state: AppState;
  commitDetail: CommitDetail | null;
  diffTarget: { file: string; hash: string } | null;
  selectCommit: (hash: string) => void;
  openDiff: (file: string, hash: string) => void;
  showContextMenu: ShowContextMenuFn;
  showPrompt: ShowPromptFn;
  requestCheckout: RequestCheckout;
  setRebaseOnto: (onto: string | null) => void;
  onCompareTo?: (from: string, to: string) => void;
  /** Счётчик запроса фокуса графа (бампается на клик по ветке) — см. CommitGraph. */
  focusNonce?: number;
  /**
   * Solo/Hide фильтр из useBranchPrefs. Если оба не заданы — useGraphFilter
   * проксирует исходный список коммитов и server-side layout. Передаются
   * сверху, чтобы один источник правды жил в useBranchPrefs (sidebar +
   * graph синхронны).
   */
  soloBranch: string | null;
  hidden: Set<string>;
  /** Сброс solo и hide (баннер «Показать все» / «Снять скрытие»). */
  onClearSolo: () => void;
  onClearAllHidden: () => void;
  /** Открыть AI Settings — нужно `CommitExplainer`'у в CommitDetails. */
  onOpenAiSettings?: () => void;
  /** Развернуть текущий файл в полноэкранной модалке сравнения. */
  onExpandDiff?: (file: string, hash: string) => void;
}

export function CommitsView({
  state, commitDetail, diffTarget,
  selectCommit, openDiff,
  showContextMenu, showPrompt, requestCheckout, setRebaseOnto,
  onCompareTo, focusNonce,
  soloBranch, hidden, onClearSolo, onClearAllHidden,
  onOpenAiSettings, onExpandDiff,
}: Props) {
  const loc = t();
  const graphHeightKey = buildStorageKey('sg-layout:commits-graph-height', state.repoPath);
  const detailWidthKey = buildStorageKey('sg-layout:commits-detail-width', state.repoPath);

  /* Активная вкладка деталей коммита. Полноценный diff живёт только на
     «Изменения»: на «Коммит» (summary) и «Дерево файлов» (snapshot) клик по
     файлу переключает на «Изменения», поэтому правую панель показываем там. */
  const [detailTab, setDetailTab] = useState<'commit' | 'changes' | 'tree'>('commit');
  const showDiffPane = !!diffTarget && detailTab === 'changes';

  /* Режим сравнения (hash вида `<from>..<to>`) не имеет данных коммита —
     вкладка «Коммит» для него пустая, а правая панель диффа на ней скрыта.
     Переключаемся на «Изменения», чтобы сразу показать список файлов и дифф. */
  const isCompareRange = commitDetail?.hash.includes('..') ?? false;
  useEffect(() => {
    if (isCompareRange) setDetailTab('changes');
  }, [isCompareRange, commitDetail?.hash]);

  /* Стрим Commit Explainer-а держим здесь, а не в CommitDetails: при
     переключении вкладок detailPane перемещается в дереве (split ↔ no-split)
     и CommitDetails ремаунтится — локальный useAiStream отменял бы запрос. */
  const explainer = useCommitExplainer(commitDetail?.hash ?? '', onOpenAiSettings ?? (() => {}));

  /* Стабильный список имён remote'ов для слияния плашек локальной/remote
     ветки в графе. Без useMemo новый массив на каждый рендер ломал бы
     React.memo CommitGraph. */
  const remoteNames = useMemo(() => state.remotes.map(r => r.name), [state.remotes]);

  const filtered = useGraphFilter(state.commits, state.branches, soloBranch, hidden);
  /* Если фильтр активен — используем результат фильтра (включая layout).
     Иначе — server-side layout из state.graphLayout (он шире, mergeLinks
     там корректные). Это даёт нулевой overhead при выключенном фильтре. */
  const graphCommits = filtered.mode === 'none' ? state.commits : filtered.commits;
  const graphNodes = filtered.mode === 'none' ? state.graphLayout.nodes : filtered.nodes;
  const graphMaxColumns = filtered.mode === 'none' ? state.graphLayout.maxColumns : filtered.maxColumns;
  const graphMergeLinks = filtered.mode === 'none' ? (state.graphLayout.mergeLinks ?? []) : filtered.mergeLinks;

  /* Мульти-выбор коммитов для batch cherry-pick. Range Shift-клика считается
     по тому же списку, что рисует граф (graphCommits). Сбрасывается при смене
     репо внутри хука. */
  const multi = useMultiSelect(graphCommits, state.repoPath);

  const banner = (() => {
    if (filtered.mode === 'solo' && soloBranch) {
      return (
        <div className={s.graphFilterBanner}>
          <span className={s.graphFilterBannerText}>
            {tpl(loc.graphFilter.soloMessage, {
              branch: soloBranch,
              kept: filtered.totalKept,
              total: filtered.totalAll,
            })}
          </span>
          <button type="button" className={s.graphFilterBannerBtn} onClick={onClearSolo}>
            {loc.graphFilter.clearSolo}
          </button>
        </div>
      );
    }
    if (filtered.mode === 'hide') {
      return (
        <div className={s.graphFilterBanner}>
          <span className={s.graphFilterBannerText}>
            {tpl(loc.graphFilter.hideMessage, {
              kept: filtered.totalKept,
              total: filtered.totalAll,
            })}
          </span>
          <button type="button" className={s.graphFilterBannerBtn} onClick={onClearAllHidden}>
            {loc.graphFilter.clearHide}
          </button>
        </div>
      );
    }
    return null;
  })();

  const allHidden = filtered.mode === 'hide' && filtered.totalKept === 0;

  const graphPane = (
    <div className={s.graphPane}>
      {banner}
      {allHidden ? (
        <div className={s.graphFilterEmpty}>
          <div>{loc.graphFilter.emptyAllHidden}</div>
          <button type="button" className={s.graphFilterBannerBtn} onClick={onClearAllHidden}>
            {loc.graphFilter.showAll}
          </button>
        </div>
      ) : (
        <CommitGraph
          commits={graphCommits}
          graphNodes={graphNodes}
          maxColumns={graphMaxColumns}
          mergeLinks={graphMergeLinks}
          selectedHash={state.selectedCommitHash}
          onSelect={selectCommit}
          selectedHashes={multi.selectedHashes}
          onMultiSelect={multi.select}
          onSelectMany={multi.selectMany}
          orderCommits={state.commits}
          onMultiCherryPickStart={multi.clear}
          currentBranch={state.currentBranch}
          remoteNames={remoteNames}
          repoPath={state.repoPath}
          onContextMenu={showContextMenu}
          showPrompt={showPrompt}
          requestCheckout={requestCheckout}
          onRebase={setRebaseOnto}
          onLoadMore={() => postCommand({ type: 'getGraphData', maxCount: state.commits.length + 50000 })}
          onCompareTo={onCompareTo}
          focusNonce={focusNonce}
          headOnRemote={state.branches.some(b => b.isCurrent && b.upstream) && state.ahead === 0}
        />
      )}
    </div>
  );

  const detailPane = (
    <div className={s.detailPane}>
      <CommitDetails
        detail={commitDetail}
        onSelectCommit={selectCommit}
        onOpenDiff={openDiff}
        onContextMenu={showContextMenu}
        onOpenAiSettings={onOpenAiSettings}
        activePath={diffTarget?.file}
        activeTab={detailTab}
        onTabChange={setDetailTab}
        explainer={explainer}
      />
    </div>
  );

  const bottomPane = (
    <div className={s.commitBottomPane}>
      {showDiffPane ? (
        <SgSplitPane
          direction="horizontal"
          defaultSize={360}
          minSize={220}
          maxSize={720}
          minOpposite={240}
          storageKey={detailWidthKey}
          left={detailPane}
          right={
            <div className={s.commitDiffPane}>
              <RightPanelContent
                diffTarget={diffTarget}
                onExpandDiff={onExpandDiff}
              />
            </div>
          }
        />
      ) : (
        detailPane
      )}
    </div>
  );

  return (
    <div className={s.commitsLayout}>
      <SgSplitPane
        direction="vertical"
        defaultSize={420}
        minSize={160}
        maxSize={2000}
        minOpposite={160}
        storageKey={graphHeightKey}
        left={graphPane}
        right={bottomPane}
      />
    </div>
  );
}
