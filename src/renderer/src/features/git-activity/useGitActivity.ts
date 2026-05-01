import { useEffect, useMemo, useRef, useState } from 'react';
import { onMainEvent, postCommand } from '../../api';
import type { GitActivityEntry, MainEvent } from '../../types';

interface UseGitActivityResult {
  entries: GitActivityEntry[];
  runningCount: number;
  currentRunning: GitActivityEntry | null;
  clear: () => void;
}

/**
 * Журнал git-активности.
 *
 * Внутри храним полный snapshot (`allEntries`) на все открытые репо —
 * `start/append/finish` ивенты приходят глобально и проще накапливать
 * один раз. Для UI отдаём отфильтрованный по `filterRepoPath` срез:
 *   - `null|undefined` → всё (legacy / отдельный «глобальный» режим);
 *   - конкретный путь → только записи с `entry.repoPath === путь`
 *     ПЛЮС записи без репо (`null`, например clone до открытия).
 *
 * Это решает «журнал общий для всех репо»: каждая вкладка видит
 * операции только своего репо, не операции соседа.
 */
export function useGitActivity(filterRepoPath?: string | null): UseGitActivityResult {
  const [allEntries, setAllEntries] = useState<GitActivityEntry[]>([]);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!requestedRef.current) {
      requestedRef.current = true;
      postCommand({ type: 'getGitActivity' });
    }

    const unsub = onMainEvent((event: MainEvent) => {
      switch (event.type) {
        case 'gitActivitySnapshot':
          setAllEntries(event.data);
          break;
        case 'gitActivityAdded':
          setAllEntries(prev => {
            const next = [event.entry, ...prev.filter(e => e.id !== event.entry.id)];
            if (next.length > 100) next.length = 100;
            return next;
          });
          break;
        case 'gitActivityUpdated':
          setAllEntries(prev => prev.map(e => e.id === event.entry.id ? event.entry : e));
          break;
        case 'gitActivityCleared':
          setAllEntries([]);
          break;
      }
    });
    return unsub;
  }, []);

  const entries = useMemo(() => {
    if (!filterRepoPath) return allEntries;
    return allEntries.filter(e => e.repoPath === filterRepoPath || e.repoPath === null);
  }, [allEntries, filterRepoPath]);

  const runningCount = useMemo(
    () => entries.reduce((acc, e) => acc + (e.status === 'running' ? 1 : 0), 0),
    [entries],
  );
  const currentRunning = useMemo(
    () => entries.find(e => e.status === 'running') ?? null,
    [entries],
  );

  return {
    entries,
    runningCount,
    currentRunning,
    clear: () => postCommand({ type: 'clearGitActivity' }),
  };
}
