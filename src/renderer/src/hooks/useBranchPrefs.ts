import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  loadBranchPrefs, savePinned, saveHidden, saveSoloBranch,
  type BranchPrefs,
} from '../features/sidebar/branchPrefsPersist';

/**
 * Per-repo состояние Fork-style фич на ветках: pin / hide / solo.
 * Перезагружает себя при смене `repoPath` — каждое репо ведёт собственный
 * набор пиннов и фильтров.
 *
 * Возвращает sets (а не массивы) для O(1) проверок в hot path рендера
 * sidebar/graph. Сохраняем в localStorage как массивы (стабильный JSON).
 */
export interface BranchPrefsState {
  pinned: Set<string>;
  hidden: Set<string>;
  soloBranch: string | null;
  togglePin: (name: string) => void;
  toggleHide: (name: string) => void;
  setSoloBranch: (name: string | null) => void;
  clearAll: () => void;
}

export function useBranchPrefs(repoPath: string): BranchPrefsState {
  const [prefs, setPrefs] = useState<BranchPrefs>(() => loadBranchPrefs(repoPath));

  useEffect(() => {
    setPrefs(loadBranchPrefs(repoPath));
  }, [repoPath]);

  const togglePin = useCallback((name: string) => {
    setPrefs(prev => {
      const set = new Set(prev.pinned);
      if (set.has(name)) set.delete(name); else set.add(name);
      const next = [...set];
      savePinned(repoPath, next);
      return { ...prev, pinned: next };
    });
  }, [repoPath]);

  const toggleHide = useCallback((name: string) => {
    setPrefs(prev => {
      const set = new Set(prev.hidden);
      if (set.has(name)) set.delete(name); else set.add(name);
      const next = [...set];
      saveHidden(repoPath, next);
      return { ...prev, hidden: next };
    });
  }, [repoPath]);

  const setSoloBranch = useCallback((name: string | null) => {
    setPrefs(prev => {
      saveSoloBranch(repoPath, name);
      return { ...prev, soloBranch: name };
    });
  }, [repoPath]);

  const clearAll = useCallback(() => {
    savePinned(repoPath, []);
    saveHidden(repoPath, []);
    saveSoloBranch(repoPath, null);
    setPrefs({ pinned: [], hidden: [], soloBranch: null });
  }, [repoPath]);

  const pinnedSet = useMemo(() => new Set(prefs.pinned), [prefs.pinned]);
  const hiddenSet = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);

  return {
    pinned: pinnedSet,
    hidden: hiddenSet,
    soloBranch: prefs.soloBranch,
    togglePin,
    toggleHide,
    setSoloBranch,
    clearAll,
  };
}
