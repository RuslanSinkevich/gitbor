import { useEffect, useRef } from 'react';
import { postCommand, onMainEvent } from '../api';
import { t, tpl } from '../i18n';
import { useWindowVisible } from './useWindowVisible';

const BASE_INTERVAL_MS = 5 * 60 * 1000;
const BACKOFF_STEPS_MS = [BASE_INTERVAL_MS, 15 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000];
const PAUSE_AFTER_FAILURES = 4;

export function useAutoFetch(
  repoPath: string,
  enabled: boolean,
  onNewCommits?: (msg: string) => void,
  onNetworkPaused?: (msg: string, retry: () => void) => void,
) {
  const prevBehindRef = useRef<number | null>(null);
  const failStreakRef = useRef(0);
  const backoffIndexRef = useRef(0);
  const visible = useWindowVisible();

  useEffect(() => {
    if (!repoPath || !enabled || !visible) return;

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
      if (
        msg.type === 'operationEnd'
        && msg.operation === 'fetch'
        && msg.source === 'background'
        && msg.repoPath === repoPath
      ) {
        if (msg.success) {
          failStreakRef.current = 0;
          backoffIndexRef.current = 0;
          return;
        }
        if (msg.errorClass === 'network' || msg.errorClass === 'auth' || msg.errorClass === 'proxy_tls') {
          failStreakRef.current += 1;
          backoffIndexRef.current = Math.min(
            backoffIndexRef.current + 1,
            BACKOFF_STEPS_MS.length - 1,
          );
          if (failStreakRef.current >= PAUSE_AFTER_FAILURES && onNetworkPaused) {
            const mins = Math.round(BACKOFF_STEPS_MS[backoffIndexRef.current] / 60_000);
            onNetworkPaused(
              tpl(t().autoFetch.paused, { minutes: String(mins) }),
              () => {
                failStreakRef.current = 0;
                postCommand({ type: 'fetch', opSource: 'background' });
              },
            );
            failStreakRef.current = 0;
          }
        }
      }
    });

    let timer: ReturnType<typeof setInterval> | null = null;
    const schedule = () => {
      if (timer) clearInterval(timer);
      const interval = BACKOFF_STEPS_MS[backoffIndexRef.current] ?? BASE_INTERVAL_MS;
      timer = setInterval(() => {
        postCommand({ type: 'fetch', opSource: 'background' });
      }, interval);
    };
    schedule();

    return () => {
      if (timer) clearInterval(timer);
      unsub();
    };
  }, [repoPath, enabled, onNewCommits, onNetworkPaused, visible]);
}
