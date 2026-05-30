import { useState, useMemo, useCallback } from 'react';
import { t } from '../../i18n';
import { postCommand, copyToClipboard } from '../../api';
import type { CommitDetail, FileChange, FileStatus } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import { AuthorAvatar } from '../../ui/AuthorAvatar';
import { CommitExplainerButton, CommitExplainerOutput, type CommitExplainerState } from '../ai';
import { buildFileTree, FileTreeItem } from '../changes/FileTree';
import s from './CommitDetails.module.css';

type Tab = 'commit' | 'changes' | 'tree';

function statusIcon(status: string): string {
  switch (status) {
    case 'M': return '●';
    case 'A': return '+';
    case 'D': return '−';
    case 'R': return '→';
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
  onFileHistory?: (file: string) => void;
  onFileBlame?: (file: string) => void;
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

export function CommitDetails({ detail, onSelectCommit, onOpenDiff, onContextMenu, onFileHistory, onFileBlame, onOpenAiSettings, activePath, activeTab, onTabChange, explainer }: Props) {
  const loc = t();
  const [tabInternal, setTabInternal] = useState<Tab>('commit');
  const tab = activeTab ?? tabInternal;
  const setTab = (next: Tab) => {
    setTabInternal(next);
    onTabChange?.(next);
  };
  /* Дерево строим тем же builder'ом, что и staged/unstaged в LocalChanges,
     и рендерим тем же FileTreeItem — чтобы вид совпадал во всех трёх местах.
     FileChange → FileStatus: добавляем staged:false (в дереве коммита оно
     не используется, нужно только для совместимости типа). */
  const tree = useMemo(() => {
    if (!detail) return [];
    const asStatus: FileStatus[] = detail.files.map((f) => ({
      path: f.path,
      status: f.status as FileStatus['status'],
      staged: false,
    }));
    return buildFileTree(asStatus);
  }, [detail]);
  const isCompareRange = detail?.hash.includes('..') ?? false;
  /* Кнопку держим в строке табов (видна при любой высоте панели), результат
     рендерим под subject. Сам стрим живёт в CommitsView (см. проп explainer). */
  const showExplainer = !isCompareRange && !!onOpenAiSettings && !!detail;

  const getFileMenuItems = useCallback((file: FileChange, commitHash: string): SgContextMenuItem[] => {
    const loc2 = t();
    const items: SgContextMenuItem[] = [
      { label: loc2.contextMenu.openDiff, action: () => onOpenDiff ? onOpenDiff(file.path, commitHash) : postCommand({ type: 'openDiff', file: file.path, hash: commitHash }) },
      { label: loc2.contextMenu.openFile, action: () => postCommand({ type: 'openFile', file: file.path }) },
    ];
    if (onFileHistory) items.push({ label: loc2.contextMenu.fileHistory, action: () => onFileHistory(file.path) });
    if (onFileBlame) items.push({ label: loc2.contextMenu.blame, action: () => onFileBlame(file.path) });
    items.push(
      { divider: true },
      { label: loc2.contextMenu.copyPath, action: () => copyToClipboard(file.path) },
      { label: loc2.contextMenu.copyFileName, action: () => copyToClipboard(file.path.split('/').pop() || file.path) },
    );
    return items;
  }, [onOpenDiff, onFileHistory, onFileBlame]);

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
          </div>
        )}

        {tab === 'changes' && (
          <div className={s.changesTab}>
            {detail.files.map(file => (
              <div
                key={file.path}
                className={`${s.fileListItem} ${activePath === file.path ? s.fileListItemActive : ''}`}
                onClick={() => onOpenDiff ? onOpenDiff(file.path, detail.hash) : postCommand({ type: 'openDiff', file: file.path, hash: detail.hash })}
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
        )}

        {tab === 'tree' && (
          <div className={s.treeTab}>
            {tree.map(node => (
              <FileTreeItem
                key={node.path}
                node={node}
                depth={0}
                section="unstaged"
                activePath={activePath}
                activeSection="unstaged"
                onClickFile={(file) => onOpenDiff ? onOpenDiff(file.path, detail.hash) : postCommand({ type: 'openDiff', file: file.path, hash: detail.hash })}
                onContextMenu={(e, file) => onContextMenu?.(e, getFileMenuItems(file, detail.hash))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
