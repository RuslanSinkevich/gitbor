import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Commit, MainEvent } from '../../types';
import { onMainEvent, postCommand } from '../../api';
import { AI_ENABLED } from '@core/buildFlags';

export type SemanticSearchState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'done'; hashes: string[] }
  | { status: 'error'; error: string };

/**
 * Поиск по графу. Два режима:
 *  - text (по умолчанию): синхронный substring-матч по subject/author/hash.
 *  - ai: семантический поиск через провайдер. Включается отдельным
 *    тумблером в UI — раньше переключение шло по префиксу `ai:`, но юзеры
 *    не понимали, что это значит. Дёргает `aiSemanticSearch` с debounce
 *    в 400 мс, результат — список hash-ей.
 */
export function useGraphSearch(commits: Commit[], onSelect: (hash: string) => void, scrollToRow: (row: number) => void) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
  const [aiMode, setAiMode] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const [semantic, setSemantic] = useState<SemanticSearchState>({ status: 'idle' });

  /* Подписка на одноразовый ответ — ставим один раз, фильтруем по
     текущему статусу. Если пришёл ответ, но юзер уже вышел из ai-режима
     или очистил поле, мы просто перезапишем result, дальше memo вернёт []
     потому что условие `aiMode && trimmed` не выполнится. */
  useEffect(() => {
    const unsub = onMainEvent((msg: MainEvent) => {
      if (msg.type !== 'aiSemanticSearchResult') return;
      if (msg.success) {
        setSemantic({ status: 'done', hashes: msg.hashes ?? [] });
      } else {
        setSemantic({ status: 'error', error: msg.error ?? 'unknown error' });
      }
    });
    return unsub;
  }, []);

  /* Триггер запроса для AI-режима с debounce. Очищение текста и переход
     в обычный режим сбрасывают semantic в idle. */
  useEffect(() => {
    if (!AI_ENABLED || !aiMode) {
      setSemantic({ status: 'idle' });
      return;
    }
    const query = searchQuery.trim();
    if (!query) {
      setSemantic({ status: 'idle' });
      return;
    }
    setSemantic({ status: 'busy' });
    const timer = setTimeout(() => {
      postCommand({ type: 'aiSemanticSearch', query, maxCommits: 200 });
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, aiMode]);

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    if (AI_ENABLED && aiMode) {
      if (semantic.status !== 'done') return [];
      const hashes = new Set(semantic.hashes);
      const out: number[] = [];
      for (let i = 0; i < commits.length; i++) {
        if (hashes.has(commits[i].hash)) out.push(i);
      }
      return out;
    }
    if (regexMode) {
      // Невалидный паттерн → пустой результат (ошибку показывает regexError,
      // UI не роняем). Матчим по subject и имени автора.
      let re: RegExp;
      try {
        re = new RegExp(searchQuery, 'i');
      } catch {
        return [];
      }
      const matches: number[] = [];
      for (let i = 0; i < commits.length; i++) {
        const c = commits[i];
        if (re.test(c.subject) || re.test(c.authorName)) matches.push(i);
      }
      return matches;
    }
    const q = searchQuery.toLowerCase();
    const matches: number[] = [];
    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      if (c.subject.toLowerCase().includes(q) || c.authorName.toLowerCase().includes(q) || c.hash.toLowerCase().startsWith(q)) {
        matches.push(i);
      }
    }
    return matches;
  }, [commits, searchQuery, aiMode, regexMode, semantic]);

  const searchMatchSet = useMemo(() => new Set(searchMatches), [searchMatches]);

  /** Хэши всех совпадений — для кнопки «Выбрать все» (массовый cherry-pick). */
  const matchedHashes = useMemo(() => searchMatches.map(i => commits[i].hash), [searchMatches, commits]);

  /** Паттерн введён, режим regexp, но не компилируется — подсветить ошибку. */
  const regexError = useMemo(() => {
    if (!regexMode || !searchQuery.trim()) return false;
    try {
      new RegExp(searchQuery, 'i');
      return false;
    } catch {
      return true;
    }
  }, [regexMode, searchQuery]);

  const navigateSearch = useCallback((dir: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const next = (searchMatchIdx + dir + searchMatches.length) % searchMatches.length;
    setSearchMatchIdx(next);
    onSelect(commits[searchMatches[next]].hash);
    scrollToRow(searchMatches[next]);
  }, [searchMatches, searchMatchIdx, commits, onSelect, scrollToRow]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'а' || e.code === 'KeyF')) {
        e.preventDefault();
        setSearchVisible(true);
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

  useEffect(() => {
    if (searchVisible) searchRef.current?.focus();
  }, [searchVisible]);

  useEffect(() => { setSearchMatchIdx(0); }, [searchQuery, aiMode, regexMode]);

  const toggleAiMode = useCallback(() => {
    if (!AI_ENABLED) return;
    setAiMode((v) => !v);
    setSemantic({ status: 'idle' });
  }, []);

  /* Regexp и AI взаимоисключающи: включение regexp гасит AI-режим (и наоборот
     семантику), чтобы searchMatches шёл по одной ветке. */
  const toggleRegexMode = useCallback(() => {
    setRegexMode((v) => {
      const next = !v;
      if (next) { setAiMode(false); setSemantic({ status: 'idle' }); }
      return next;
    });
  }, []);

  return {
    searchRef, searchQuery, setSearchQuery, searchVisible, setSearchVisible,
    searchMatchIdx, searchMatches, searchMatchSet, matchedHashes, navigateSearch,
    semantic, aiMode, toggleAiMode,
    regexMode, toggleRegexMode, regexError,
  };
}
