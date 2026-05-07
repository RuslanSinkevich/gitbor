import { useCallback } from 'react';
import { t } from '../../i18n';
import { postCommand, copyToClipboard } from '../../api';
import type { RepoInfo, RendererCommand } from '../../types';
import type { SgContextMenuItem } from '../../ui/SgContextMenu';
import s from './RepoTabs.module.css';

interface Props {
  repos: RepoInfo[];
  activeIndex: number;
  hasChanges?: boolean;
  onSwitch?: (index: number) => void;
  /** true — сейчас открыт RepoManager (псевдо-таб «+»), активный репо-таб не выделен. */
  managerActive?: boolean;
  /** Клик по «+»: открыть RepoManager как вкладку, а не системный диалог. */
  onShowManager?: () => void;
  /**
   * Контекстное меню на репо-табе. Делегируем единственному инстансу
   * `useContextMenu` в App.tsx — иначе рядом висят два меню (свой портал
   * у RepoTabs, общий у App), они закрываются по разным событиям и могут
   * перекрываться визуально.
   */
  onContextMenu?: (e: React.MouseEvent, items: SgContextMenuItem[]) => void;
}

/**
 * `openPathInExplorer` НЕ описан в `RendererCommand` union (см.
 * handlersShell.ts) — кастуем при отправке. Таблица IPC main-side
 * принимает команду по имени.
 */
function postOpenPathInExplorer(path: string): void {
  postCommand({ type: 'openPathInExplorer', path } as unknown as RendererCommand);
}

function buildContextItems(
  repos: RepoInfo[],
  index: number,
  loc: ReturnType<typeof t>,
): SgContextMenuItem[] {
  const repo = repos[index];
  const ctxLoc = loc.repoTabs.context;
  const items: SgContextMenuItem[] = [];

  items.push({ label: ctxLoc.close, action: () => postCommand({ type: 'closeRepo', index }) });

  if (repos.length > 1) {
    items.push({
      label: ctxLoc.closeOthers,
      action: () => {
        // Идём с конца — индексы сжимаются после каждого closeRepo, и
        // справа налево это безопасно: позиция нашего `index` не сдвигается.
        for (let i = repos.length - 1; i >= 0; i--) {
          if (i !== index) postCommand({ type: 'closeRepo', index: i });
        }
      },
    });
  }

  if (index < repos.length - 1) {
    items.push({
      label: ctxLoc.closeToRight,
      action: () => {
        for (let i = repos.length - 1; i > index; i--) {
          postCommand({ type: 'closeRepo', index: i });
        }
      },
    });
  }

  items.push({ divider: true });
  items.push({ label: ctxLoc.openInExplorer, action: () => postOpenPathInExplorer(repo.path) });
  items.push({ label: ctxLoc.copyPath, action: () => copyToClipboard(repo.path) });

  return items;
}

export function RepoTabs({ repos, activeIndex, hasChanges, onSwitch, managerActive, onShowManager, onContextMenu }: Props) {
  const loc = t();

  const handleContext = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    if (!onContextMenu) return;
    const items = buildContextItems(repos, index, loc);
    onContextMenu(e, items);
  }, [repos, loc, onContextMenu]);

  return (
    <div className={s.root}>
      <div className={s.tabs}>
        {repos.map((repo, i) => (
          <div
            key={repo.path}
            className={`${s.tab} ${(!managerActive && i === activeIndex) ? s.tabActive : ''}`}
            onClick={() => onSwitch ? onSwitch(i) : postCommand({ type: 'switchRepo', index: i })}
            onContextMenu={(e) => handleContext(e, i)}
            title={repo.path}
          >
            <span className={s.tabName}>{repo.name}</span>
            {!managerActive && i === activeIndex && hasChanges && <span className={s.tabDot} />}
            <button
              className={s.tabClose}
              onClick={(e) => { e.stopPropagation(); postCommand({ type: 'closeRepo', index: i }); }}
              title={loc.repoTabs.context.close}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className={`${s.addBtn} ${managerActive ? s.addBtnActive : ''}`}
        onClick={() => onShowManager ? onShowManager() : postCommand({ type: 'openRepoDialog' })}
        title={loc.repoManager.title}
      >
        +
      </button>
    </div>
  );
}
