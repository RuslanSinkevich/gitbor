import { useEffect, useMemo, useRef, useState } from 'react';
import { onMainEvent, postCommand } from '../../api';
import type { GitActivityEntry, MainEvent } from '../../types';

interface UseGitActivityResult {
  entries: GitActivityEntry[];
  runningCount: number;
  currentRunning: GitActivityEntry | null;
  clear: () => void;
}

export function useGitActivity(): UseGitActivityResult {
  const [entries, setEntries] = useState<GitActivityEntry[]>([]);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!requestedRef.current) {
      requestedRef.current = true;
      postCommand({ type: 'getGitActivity' });
    }

    const unsub = onMainEvent((event: MainEvent) => {
      switch (event.type) {
        case 'gitActivitySnapshot':
          setEntries(event.data);
          break;
        case 'gitActivityAdded':
          setEntries(prev => {
            const next = [event.entry, ...prev.filter(e => e.id !== event.entry.id)];
            if (next.length > 100) next.length = 100;
            return next;
          });
          break;
        case 'gitActivityUpdated':
          setEntries(prev => prev.map(e => e.id === event.entry.id ? event.entry : e));
          break;
        case 'gitActivityCleared':
          setEntries([]);
          break;
      }
    });
    return unsub;
  }, []);

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
