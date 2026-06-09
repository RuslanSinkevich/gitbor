import { useEffect, useRef, useState } from 'react';
import { invokeCommand } from '../api';
import {
  addRecentRepo,
  clearLastActiveRepo,
  findRepoIndexByPath,
  loadLastActiveRepo,
  loadOpenRepos,
  removeRecentRepo,
  saveLastActiveRepo,
  saveOpenRepos,
} from '../features/repo-manager';
import type { RepoInfo } from '../types';

interface UseRestoreRepoTabsOptions {
  repoPath: string;
  repoName: string;
  openRepos: RepoInfo[];
  activeRepoIndex: number;
  switchRepoFast: (index: number) => void;
}

/**
 * Восстановление открытых repo tabs после старта renderer.
 *
 * Важно: `openRepo` открывает табы по одному и каждый временно становится
 * активным. Поэтому сохраняем целевой last-active path один раз при маунте,
 * не перезаписываем его промежуточными repoPath, а UI может скрыть workspace
 * через `isRestoringTabs`, пока debounce не выберет правильный активный таб.
 */
export function useRestoreRepoTabs({
  repoPath,
  repoName,
  openRepos,
  activeRepoIndex,
  switchRepoFast,
}: UseRestoreRepoTabsOptions): { isRestoringTabs: boolean } {
  const restoreLastRepoAttempted = useRef(false);
  const restoreActiveTabDone = useRef(false);
  const targetActiveRepoRef = useRef<string | null>(null);
  const [isRestoringTabs, setIsRestoringTabs] = useState(false);

  useEffect(() => {
    if (restoreLastRepoAttempted.current) return;
    restoreLastRepoAttempted.current = true;

    const openPaths = loadOpenRepos();
    const last = loadLastActiveRepo();
    targetActiveRepoRef.current = last;

    if (openPaths.length > 0) {
      if (last && openPaths.length > 1) setIsRestoringTabs(true);
      for (const p of openPaths) {
        void invokeCommand({ type: 'openRepo', path: p }).catch(() => {
          // Репо удалили/переименовали — следующий saveOpenRepos перепишет список.
        });
      }
      return;
    }

    if (last && !repoPath) {
      void invokeCommand({ type: 'openRepo', path: last }).catch(() => {
        clearLastActiveRepo();
        removeRecentRepo(last);
      });
    }
  }, []);

  useEffect(() => {
    if (!restoreActiveTabDone.current) return;
    if (repoPath && repoName) {
      saveLastActiveRepo(repoPath);
      addRecentRepo(repoName, repoPath);
    }
  }, [repoPath, repoName]);

  useEffect(() => {
    if (!restoreLastRepoAttempted.current) return;
    saveOpenRepos(openRepos.map(r => r.path));
  }, [openRepos]);

  useEffect(() => {
    if (restoreActiveTabDone.current) return;
    if (openRepos.length === 0) return;

    const last = targetActiveRepoRef.current;
    if (!last) {
      restoreActiveTabDone.current = true;
      setIsRestoringTabs(false);
      return;
    }

    const timer = setTimeout(() => {
      const idx = findRepoIndexByPath(openRepos, last);
      if (idx >= 0 && idx !== activeRepoIndex) {
        switchRepoFast(idx);
      }
      restoreActiveTabDone.current = true;
      setIsRestoringTabs(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [openRepos, activeRepoIndex, switchRepoFast]);

  return { isRestoringTabs };
}
