import { useState, useMemo, useCallback } from 'react';
import { t } from '../../i18n';
import { postCommand } from '../../api';
import type { CommitDetail, FileChange } from '../../types';
import s from './CommitDetails.module.css';

type Tab = 'commit' | 'changes' | 'tree';

interface FileTreeNode {
  name: string;
  path: string;
  status?: string;
  children: FileTreeNode[];
}

function buildFileTree(files: FileChange[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      let existing = current.find(n => n.name === name);
      if (!existing) {
        existing = { name, path: parts.slice(0, i + 1).join('/'), status: isFile ? file.status : undefined, children: [] };
        current.push(existing);
      }
      current = existing.children;
    }
  }
  return root;
}

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

function FileTreeItem({ node, depth, commitHash, onOpenDiff, activePath }: { node: FileTreeNode; depth: number; commitHash: string; onOpenDiff?: (file: string, hash: string) => void; activePath?: string }) {
  const [expanded, setExpanded] = useState(true);
  const isDir = node.children.length > 0;

  const handleClick = () => {
    if (isDir) setExpanded(e => !e);
    else if (onOpenDiff) onOpenDiff(node.path, commitHash);
    else postCommand({ type: 'openDiff', file: node.path, hash: commitHash });
  };

  return (
    <>
      <div className={`${s.fileTreeRow} ${!isDir && activePath === node.path ? s.fileTreeRowActive : ''}`} style={{ paddingLeft: depth * 16 + 4 }} onClick={handleClick}>
        {isDir ? (
          <span className={`${s.fileTreeArrow} ${expanded ? s.fileTreeArrowExpanded : ''}`}>&#9656;</span>
        ) : (
          <span className={s.fileTreeArrowPlaceholder} />
        )}
        <span className={s.fileTreeName}>{node.name}</span>
        {node.status && (
          <span className={`${s.fileTreeStatus} ${statusCls(node.status)}`}>{statusIcon(node.status)}</span>
        )}
      </div>
      {isDir && expanded && node.children.map(child => (
        <FileTreeItem key={child.path} node={child} depth={depth + 1} commitHash={commitHash} onOpenDiff={onOpenDiff} activePath={activePath} />
      ))}
    </>
  );
}

interface Props {
  detail: CommitDetail | null;
  onSelectCommit?: (hash: string) => void;
  onOpenDiff?: (file: string, hash: string) => void;
  activePath?: string;
}

export function CommitDetails({ detail, onSelectCommit, onOpenDiff, activePath }: Props) {
  const loc = t();
  const [tab, setTab] = useState<Tab>('commit');
  const tree = useMemo(() => detail ? buildFileTree(detail.files) : [], [detail]);

  const copySha = useCallback(() => {
    if (detail) navigator.clipboard.writeText(detail.hash);
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
      </div>

      <div className={s.content}>
        {tab === 'commit' && (
          <div className={s.commitTab}>
            <h3 className={s.subject}>{detail.subject}</h3>
            {detail.body && <pre className={s.body}>{detail.body}</pre>}
            <div className={s.meta}>
              <div className={s.metaRow}>
                <span className={s.label}>{loc.details.author}:</span>
                <span>{detail.authorName} &lt;{detail.authorEmail}&gt;</span>
              </div>
              <div className={s.metaRow}>
                <span className={s.label}>{loc.graph.date}:</span>
                <span>{formatDate(detail.authorDate)}</span>
              </div>
              <div className={s.metaRow}>
                <span className={s.label}>{loc.details.sha}:</span>
                <span className={s.sha} onClick={copySha} title="Click to copy">{detail.hash}</span>
              </div>
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
              >
                <span className={`${s.fileStatus} ${statusCls(file.status)}`}>{statusIcon(file.status)}</span>
                <span className={s.filePath}>{file.path}</span>
              </div>
            ))}
            {detail.files.length === 0 && (
              <div className={s.emptyFiles}>No changed files</div>
            )}
          </div>
        )}

        {tab === 'tree' && (
          <div className={s.treeTab}>
            {tree.map(node => (
              <FileTreeItem key={node.path} node={node} depth={0} commitHash={detail.hash} onOpenDiff={onOpenDiff} activePath={activePath} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
