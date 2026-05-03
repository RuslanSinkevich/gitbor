import { useCallback } from 'react';
import { t } from '../../i18n';
import { postCommand, copyToClipboard } from '../../api';
import type { RepoInfo } from '../../types';
import { SgContextMenu, type SgContextMenuItem } from '../../ui/SgContextMenu';
import { useState } from 'react';
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
}

export function RepoTabs({ repos, activeIndex, hasChanges, onSwitch, managerActive, onShowManager }: Props) {
  const loc = t();
  const [ctx, setCtx] = useState<{ x: number; y: number; items: SgContextMenuItem[] } | null>(null);

  const handleContext = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    const repo = repos[index];
    const items: SgContextMenuItem[] = [
      { label: loc.menu.closeRepo, action: () => postCommand({ type: 'closeRepo', index }) },
      { label: loc.contextMenu.copyPath, action: () => copyToClipboard(repo.path) },
    ];
    if (repos.length > 1) {
      items.splice(1, 0, {
        label: loc.repoManager.title,
        action: () => {
          for (let i = repos.length - 1; i >= 0; i--) {
            if (i !== index) postCommand({ type: 'closeRepo', index: i });
          }
        },
      });
    }
    setCtx({ x: e.clientX, y: e.clientY, items });
  }, [repos, loc]);

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
              title={loc.menu.closeRepo}
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
      {ctx && <SgContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
    </div>
  );
}
