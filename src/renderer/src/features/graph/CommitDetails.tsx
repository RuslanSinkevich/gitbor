import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { postCommand, copyToClipboard, invokeCommand } from '../../api';
import type { CommitDetail, FileChange, FileStatus } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { AuthorAvatar } from '../../ui/AuthorAvatar';
import { CommitExplainerButton, CommitExplainerOutput, type CommitExplainerState } from '../ai';
import { buildFileTree, FileTreeItem } from '../changes/FileTree';
import { FileHistoryModal } from '../file-history';
import { BlameModal } from '../blame';
import { AI_ENABLED } from '@core/buildFlags';
import s from './CommitDetails.module.css';

type Tab = 'commit' | 'changes' | 'tree';

function statusIcon(status: string): string {
  switch (status) {
    case 'M': return 'M';
    case 'A': return '+';
    case 'D': return '−';
    case 'R': return 'R';
    default: return '?';
  }
}

function statusCls(status: string): string {
  switch (status) {
    case 'M': return s.statusModified;
    case 'A': return s.statusAdded;
    case 'D': return s.statusDeleted;
    case 'R': return s.statusRenamed;
    default: return s.statusUnknown;
  }
}

function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

interface Props {
  detail: CommitDetail | null;
  onSelectCommit?: (hash: string) => void;
  onOpenDiff?: (file: string, hash: string) => void;
  onContextMenu?: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
  /** Открыть AI Settings — нужно `CommitExplainer`'у когда конфиг отсутствует. */
  onOpenAiSettings?: () => void;
  activePath?: string;
  /** Управляемая вкладка: родителю (CommitsView) нужно знать активную вкладку,
      чтобы скрывать правую панель диффа на вкладке «Коммит». */
  activeTab?: Tab;
  onTabChange?: (tab: Tab) => void;
  /** Состояние Commit Explainer-а лифтится в CommitsView: при переключении
      вкладок detailPane ремаунтится, и локальный useAiStream отменял бы
      in-flight запрос. Держим стрим в родителе, который не ремаунтится. */
  explainer: CommitExplainerState;
}

export function CommitDetails({ detail, onSelectCommit, onOpenDiff, onContextMenu, onOpenAiSettings, activePath, activeTab, onTabChange, explainer }: Props) {
  const loc = t();
  const [tabInternal, setTabInternal] = useState<Tab>('commit');
  // История файла / Blame: модалки держат своё open/close состояние ВНУТРИ
  // деталей коммита (как в LocalChanges), а не через правую панель App.
  // null = закрыта. Blame считаем на ревизии коммита (см. blameTarget.hash).
  const [historyFile, setHistoryFile] = useState<string | null>(null);
  const [blameTarget, setBlameTarget] = useState<{ file: string; hash: string } | null>(null);
  const tab = activeTab ?? tabInternal;
  const setTab = useCallback((next: Tab) => {
    setTabInternal(next);
    onTabChange?.(next);
  }, [onTabChange]);
  /* File Tree — полный снимок дерева репозитория на коммите (git ls-tree),
     а НЕ только изменённые файлы. Тянем пути по invoke лениво (при открытии
     вкладки) и кешируем по hash, чтобы не дёргать git при каждом ре-рендере
     и переключении вкладок. */
  const [treePaths, setTreePaths] = useState<string[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const treeCache = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (tab !== 'tree' || !detail) return;
    const hash = detail.hash;
    // Снимок дерева для диапазона сравнения (`a..b`) не определён — пропускаем.
    if (hash.includes('..')) { setTreePaths([]); return; }
    const cached = treeCache.current.get(hash);
    if (cached) { setTreePaths(cached); return; }
    let cancelled = false;
    setTreeLoading(true);
    invokeCommand({ type: 'getCommitTree', hash })
      .then((res) => {
        const paths = Array.isArray(res) ? (res as string[]) : [];
        treeCache.current.set(hash, paths);
        if (!cancelled) setTreePaths(paths);
      })
      .catch(() => { if (!cancelled) setTreePaths([]); })
      .finally(() => { if (!cancelled) setTreeLoading(false); });
    return () => { cancelled = true; };
  }, [tab, detail]);

  const tree = useMemo(() => {
    if (treePaths.length === 0) return [];
    // Снимок дерева: статус diff'а тут не имеет смысла — рендерим plain.
    const asStatus: FileStatus[] = treePaths.map((path) => ({ path, status: 'M', staged: false }));
    return buildFileTree(asStatus);
  }, [treePaths]);

  const changedTree = useMemo(() => {
    if (!detail) return [];
    const asStatus: FileStatus[] = detail.files.map((f) => ({
      path: f.path,
      status: f.status as FileStatus['status'],
      staged: false,
    }));
    return buildFileTree(asStatus);
  }, [detail]);

  /* Клик по файлу в summary («Коммит»): на «Изменения» + diff.
     Из дерева — открываем панель справа без смены вкладки; CommitsView
     на «Дереве» показывает содержимое файла (не diff). */
  const openDiff = useCallback((path: string, hash: string) => {
    if (onOpenDiff) onOpenDiff(path, hash);
    else postCommand({ type: 'openDiff', file: path, hash });
  }, [onOpenDiff]);
  const openInChanges = useCallback((path: string, hash: string) => {
    setTab('changes');
    openDiff(path, hash);
  }, [openDiff, setTab]);
  const isCompareRange = detail?.hash.includes('..') ?? false;
  /* Кнопку держим в строке табов (видна при любой высоте панели), результат
     рендерим под subject. Сам стрим живёт в CommitsView (см. проп explainer). */
  const showExplainer = AI_ENABLED && !isCompareRange && !!onOpenAiSettings && !!detail;

  const getFileMenuItems = useCallback((file: FileChange, commitHash: string): SgContextMenuItem[] => {
    const loc2 = t();
    const items: SgContextMenuItem[] = [
      { label: loc2.contextMenu.openDiff, action: () => onOpenDiff ? onOpenDiff(file.path, commitHash) : postCommand({ type: 'openDiff', file: file.path, hash: commitHash }) },
      { label: loc2.contextMenu.openFile, action: () => postCommand({ type: 'openFile', file: file.path }) },
    ];
    items.push({ label: loc2.contextMenu.fileHistory, help: loc2.contextMenu.help.fileHistory, action: () => setHistoryFile(file.path) });
    // Blame на ревизии коммита: для диапазона сравнения `a..b` берём правую
    // границу `b`, иначе git blame ругается на неверный revision.
    const blameHash = commitHash.includes('..') ? commitHash.split('..')[1] : commitHash;
    items.push({ label: loc2.contextMenu.blame, help: loc2.contextMenu.help.blame, action: () => setBlameTarget({ file: file.path, hash: blameHash }) });
    items.push(
      { divider: true },
      { label: loc2.contextMenu.copyPath, action: () => copyToClipboard(file.path) },
      { label: loc2.contextMenu.copyFileName, action: () => copyToClipboard(file.path.split('/').pop() || file.path) },
    );
    return items;
  }, [onOpenDiff]);

  const copySha = useCallback(() => {
    if (detail) copyToClipboard(detail.hash);
  }, [detail]);

  const goToParent = useCallback((hash: string) => {
    if (onSelectCommit) onSelectCommit(hash);
  }, [onSelectCommit]);

  if (!detail) {
    return <div className={`${s.root} ${s.empty}`}><p>{loc.details.selectCommit}</p></div>;
  }

  return (
    <div className={s.root}>
      <div className={s.tabs}>
        <button className={`${s.tab} ${tab === 'commit' ? s.tabActive : ''}`} onClick={() => setTab('commit')}>
          {loc.details.commit}
        </button>
        <button className={`${s.tab} ${tab === 'changes' ? s.tabActive : ''}`} onClick={() => setTab('changes')}>
          {loc.details.changes} ({detail.files.length})
        </button>
        <button className={`${s.tab} ${tab === 'tree' ? s.tabActive : ''}`} onClick={() => setTab('tree')}>
          {loc.details.fileTree}
        </button>
        {showExplainer && (
          <div className={s.tabsActions}>
            <CommitExplainerButton
              state={explainer}
              onFocusCommitTab={() => setTab('commit')}
            />
          </div>
        )}
      </div>

      <div className={s.content}>
        {tab === 'commit' && (
          <div className={s.commitTab}>
            <h3 className={s.subject}>{detail.subject}</h3>
            {detail.body && <pre className={s.body}>{detail.body}</pre>}
            {showExplainer && <CommitExplainerOutput state={explainer} />}
            <div className={s.meta}>
              {!isCompareRange && (
                <>
                  <div className={s.metaRow}>
                    <span className={s.label}>{loc.details.author}:</span>
                    <span className={s.authorLine}>
                      <AuthorAvatar name={detail.authorName} email={detail.authorEmail} size="md" />
                      <span>{detail.authorName} &lt;{detail.authorEmail}&gt;</span>
                    </span>
                  </div>
                  <div className={s.metaRow}>
                    <span className={s.label}>{loc.graph.date}:</span>
                    <span>{formatDate(detail.authorDate)}</span>
                  </div>
                </>
              )}
              {!isCompareRange && (
                <div className={s.metaRow}>
                  <span className={s.label}>{loc.details.sha}:</span>
                  <span className={s.sha} onClick={copySha} title={loc.details.clickToCopy}>{detail.hash}</span>
                </div>
              )}
              {detail.parents.length > 0 && (
                <div className={s.metaRow}>
                  <span className={s.label}>{loc.details.parent}:</span>
                  <span className={s.parents}>
                    {detail.parents.map(p => (
                      <span key={p} className={s.parentLink} onClick={() => goToParent(p)}>{p.substring(0, 7)}</span>
                    ))}
                  </span>
                </div>
              )}
            </div>

            {/* Компактная сводка изменённых файлов. Клик открывает файл во
                вкладке «Изменения» — полноценный diff живёт только там. */}
            <div className={s.summaryFiles}>
              <div className={s.summaryHeader}>
                {loc.details.changes} ({detail.files.length})
              </div>
              {detail.files.map(file => (
                <div
                  key={file.path}
                  className={`${s.fileListItem} ${activePath === file.path ? s.fileListItemActive : ''}`}
                  onClick={() => openInChanges(file.path, detail.hash)}
                  onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, getFileMenuItems(file, detail.hash)); }}
                >
                  <span className={`${s.fileStatus} ${statusCls(file.status)}`}>{statusIcon(file.status)}</span>
                  <span className={s.filePath}>{file.path}</span>
                </div>
              ))}
              {detail.files.length === 0 && (
                <div className={s.emptyFiles}>{loc.details.noChangedFiles}</div>
              )}
            </div>
          </div>
        )}

        {tab === 'changes' && (
          <div className={s.changesTab}>
            {changedTree.map(node => (
              <FileTreeItem
                key={`${detail.hash}:changes:${node.path}`}
                node={node}
                depth={0}
                section="unstaged"
                activePath={activePath}
                activeSection="unstaged"
                defaultExpanded
                onClickFile={(file) => openInChanges(file.path, detail.hash)}
                onContextMenu={(e, file) => onContextMenu?.(e, getFileMenuItems(file, detail.hash))}
              />
            ))}
            {detail.files.length === 0 && (
              <div className={s.emptyFiles}>{loc.details.noChangedFiles}</div>
            )}
          </div>
        )}

        {tab === 'tree' && (
          <div className={s.treeTab}>
            {treeLoading && tree.length === 0 && (
              <div className={s.emptyFiles}>{loc.details.loadingTree}</div>
            )}
            {!treeLoading && tree.length === 0 && (
              <div className={s.emptyFiles}>{loc.details.emptyTree}</div>
            )}
            {tree.map(node => (
              <FileTreeItem
                key={`${detail.hash}:tree:${node.path}`}
                node={node}
                depth={0}
                section="unstaged"
                activePath={activePath}
                activeSection="unstaged"
                plain
                defaultExpanded={false}
                onClickFile={(file) => openDiff(file.path, detail.hash)}
                onContextMenu={(e, file) => onContextMenu?.(e, getFileMenuItems(file, detail.hash))}
              />
            ))}
          </div>
        )}
      </div>

      {historyFile && (
        <FileHistoryModal
          file={historyFile}
          onClose={() => setHistoryFile(null)}
        />
      )}

      {blameTarget && (
        <BlameModal
          file={blameTarget.file}
          hash={blameTarget.hash}
          onClose={() => setBlameTarget(null)}
        />
      )}
    </div>
  );
}
