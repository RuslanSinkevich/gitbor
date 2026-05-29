import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  loadBranchPrefs, savePinned, saveHidden, saveSoloBranch, saveBranchNotes,
  migrateBranchPrefs,
  type BranchPrefs,
} from '../features/sidebar/branchPrefsPersist';

/**
 * Per-repo состояние Fork-style фич на ветках: pin / hide / solo / notes.
 * Перезагружает себя при смене `repoPath` — каждое репо ведёт собственный
 * набор пиннов и фильтров.
 *
 * Возвращает sets (а не массивы) для O(1) проверок в hot path рендера
 * sidebar/graph. Сохраняем в localStorage как массивы (стабильный JSON).
 *
 * Заметки — Record<branchName, text>; пустой текст удаляет запись.
 * Используются для tooltip на иконке Info и для модалки редактирования.
 */
export interface BranchPrefsState {
  pinned: Set<string>;
  hidden: Set<string>;
  soloBranch: string | null;
  notes: Record<string, string>;
  togglePin: (name: string) => void;
  toggleHide: (name: string) => void;
  setSoloBranch: (name: string | null) => void;
  setNote: (branchName: string, text: string) => void;
  /** Перенести prefs при переименовании ветки (`git branch -m`). */
  renameBranch: (oldName: string, newName: string) => void;
  /** Сбросить hidden для всего репо разом (баннер «Показать все ветки»). */
  clearAllHidden: () => void;
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

  const setNote = useCallback((branchName: string, text: string) => {
    setPrefs(prev => {
      const trimmed = text.trim();
      const nextNotes = { ...prev.notes };
      if (trimmed.length === 0) delete nextNotes[branchName];
      else nextNotes[branchName] = text;
      saveBranchNotes(repoPath, nextNotes);
      return { ...prev, notes: nextNotes };
    });
  }, [repoPath]);

  const renameBranch = useCallback((oldName: string, newName: string) => {
    if (!oldName || !newName || oldName === newName) return;
    setPrefs(prev => {
      const next = migrateBranchPrefs(prev, oldName, newName);
      if (next === prev) return prev;
      savePinned(repoPath, next.pinned);
      saveHidden(repoPath, next.hidden);
      saveSoloBranch(repoPath, next.soloBranch);
      saveBranchNotes(repoPath, next.notes);
      return next;
    });
  }, [repoPath]);

  const clearAllHidden = useCallback(() => {
    setPrefs(prev => {
      if (prev.hidden.length === 0) return prev;
      saveHidden(repoPath, []);
      return { ...prev, hidden: [] };
    });
  }, [repoPath]);

  const clearAll = useCallback(() => {
    savePinned(repoPath, []);
    saveHidden(repoPath, []);
    saveSoloBranch(repoPath, null);
    saveBranchNotes(repoPath, {});
    setPrefs({ pinned: [], hidden: [], soloBranch: null, notes: {} });
  }, [repoPath]);

  const pinnedSet = useMemo(() => new Set(prefs.pinned), [prefs.pinned]);
  const hiddenSet = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);

  return {
    pinned: pinnedSet,
    hidden: hiddenSet,
    soloBranch: prefs.soloBranch,
    notes: prefs.notes,
    togglePin,
    toggleHide,
    setSoloBranch,
    setNote,
    renameBranch,
    clearAllHidden,
    clearAll,
  };
}
