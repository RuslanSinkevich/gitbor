import { useCallback, useEffect, useRef, useState } from 'react';
import type { Commit } from '../../types';

/**
 * Режим клика по строке графа:
 *  - `single` — обычный клик: сбросить мульти-выбор (деталь коммита открывает
 *    вызывающий код через onSelect);
 *  - `toggle` — Ctrl/Cmd+клик: добавить/убрать один коммит;
 *  - `range`  — Shift+клик: выделить диапазон от якоря до текущего коммита.
 */
export type MultiSelectMode = 'toggle' | 'range' | 'single';

export interface MultiSelect {
  selectedHashes: Set<string>;
  select: (hash: string, mode: MultiSelectMode) => void;
  clear: () => void;
  selectMany: (hashes: string[]) => void;
}

/**
 * Мульти-выбор коммитов в графе (Ctrl/Shift-клик, «выбрать все совпадения»).
 * Чисто UI-состояние вкладки — живёт здесь, а не в глобальном AppState.
 * Сбрасывается при смене репозитория (`repoPath`).
 *
 * Диапазон Shift+клика считается по индексам в текущем `commits` (topo-порядок,
 * новые сверху) от якоря до кликнутого — направление неважно.
 */
export function useMultiSelect(commits: Commit[], repoPath?: string): MultiSelect {
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);

  useEffect(() => {
    setSelectedHashes(new Set());
    anchorRef.current = null;
  }, [repoPath]);

  const select = useCallback((hash: string, mode: MultiSelectMode) => {
    if (mode === 'single') {
      anchorRef.current = hash;
      setSelectedHashes(prev => (prev.size === 0 ? prev : new Set()));
      return;
    }
    if (mode === 'toggle') {
      anchorRef.current = hash;
      setSelectedHashes(prev => {
        const next = new Set(prev);
        if (next.has(hash)) next.delete(hash);
        else next.add(hash);
        return next;
      });
      return;
    }
    // range
    const anchor = anchorRef.current ?? hash;
    const ai = commits.findIndex(c => c.hash === anchor);
    const bi = commits.findIndex(c => c.hash === hash);
    if (ai < 0 || bi < 0) {
      anchorRef.current = hash;
      setSelectedHashes(new Set([hash]));
      return;
    }
    const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
    setSelectedHashes(prev => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) next.add(commits[i].hash);
      return next;
    });
  }, [commits]);

  const clear = useCallback(() => {
    anchorRef.current = null;
    setSelectedHashes(prev => (prev.size === 0 ? prev : new Set()));
  }, []);

  const selectMany = useCallback((hashes: string[]) => {
    anchorRef.current = hashes.length > 0 ? hashes[0] : null;
    setSelectedHashes(new Set(hashes));
  }, []);

  return { selectedHashes, select, clear, selectMany };
}
