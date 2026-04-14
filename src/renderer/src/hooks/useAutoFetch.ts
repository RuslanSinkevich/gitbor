import { useEffect, useRef } from 'react';
import { postCommand, onMainEvent } from '../api';
import { t, tpl } from '../i18n';

const AUTO_FETCH_INTERVAL = 5 * 60 * 1000;

export function useAutoFetch(
  repoPath: string,
  enabled: boolean,
  onNewCommits?: (msg: string) => void,
) {
  const prevBehindRef = useRef<number | null>(null);

  useEffect(() => {
    if (!repoPath || !enabled) return;

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'stateUpdate' && msg.data.behind !== undefined) {
        const behind = msg.data.behind;
        if (prevBehindRef.current !== null && behind > prevBehindRef.current && onNewCommits) {
          const diff = behind - prevBehindRef.current;
          onNewCommits(tpl(t().autoFetch.newCommits, { count: diff }));
        }
        prevBehindRef.current = behind;
      }
      if (msg.type === 'fullState') {
        prevBehindRef.current = msg.data.behind ?? 0;
      }
    });

    const timer = setInterval(() => {
      postCommand({ type: 'fetch' });
    }, AUTO_FETCH_INTERVAL);

    return () => {
      clearInterval(timer);
      unsub();
    };
  }, [repoPath, enabled, onNewCommits]);
}
