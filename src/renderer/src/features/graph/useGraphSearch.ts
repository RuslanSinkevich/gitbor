import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Commit } from '../../types';

export function useGraphSearch(commits: Commit[], onSelect: (hash: string) => void, scrollToRow: (row: number) => void) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const matches: number[] = [];
    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      if (c.subject.toLowerCase().includes(q) || c.authorName.toLowerCase().includes(q) || c.hash.toLowerCase().startsWith(q)) {
        matches.push(i);
      }
    }
    return matches;
  }, [commits, searchQuery]);

  const searchMatchSet = useMemo(() => new Set(searchMatches), [searchMatches]);

  const navigateSearch = useCallback((dir: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const next = (searchMatchIdx + dir + searchMatches.length) % searchMatches.length;
    setSearchMatchIdx(next);
    onSelect(commits[searchMatches[next]].hash);
    scrollToRow(searchMatches[next]);
  }, [searchMatches, searchMatchIdx, commits, onSelect, scrollToRow]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchVisible(true);
        // Если input уже примонтирован (повторный Ctrl+F при открытой
        // панели) — фокусим сразу. Иначе focus поставит effect ниже,
        // когда searchRef.current появится после рендера.
        searchRef.current?.focus();
      }
      if (e.key === 'Escape' && searchVisible) {
        setSearchVisible(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchVisible]);

  // Автофокус search-input ровно один раз — на переход hidden→visible.
  // Без таймера: эффект бежит после commit'а, ref уже привязан.
  useEffect(() => {
    if (searchVisible) searchRef.current?.focus();
  }, [searchVisible]);

  useEffect(() => { setSearchMatchIdx(0); }, [searchQuery]);

  return {
    searchRef, searchQuery, setSearchQuery, searchVisible, setSearchVisible,
    searchMatchIdx, searchMatches, searchMatchSet, navigateSearch,
  };
}
