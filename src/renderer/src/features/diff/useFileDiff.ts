import { useEffect, useState } from 'react';
import type { FileDiff } from '../../types';
import { t } from '../../i18n';
import { postCommand, onMainEvent, isElectron } from '../../api';

const DIFF_TIMEOUT_MS = 15_000;

export interface FileDiffState {
  diffs: FileDiff[] | null;
  loading: boolean;
  error: string | null;
}

/**
 * Загружает diff файла через IPC и подписывается на ответ `fileDiff`.
 * Единый источник правды для DiffPanel и CompareModal — чтобы поведение
 * (таймаут, матч по file+hash, fullContext) не расходилось.
 */
export function useFileDiff(
  file: string, hash: string, ignoreWs: boolean, fullContext: boolean, enabled: boolean,
): FileDiffState {
  const loc = t();
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (!isElectron) {
      setLoading(false);
      setError(loc.diff.ipcUnavailable);
      return;
    }

    setLoading(true);
    setDiffs(null);
    setError(null);
    postCommand({ type: 'getFileDiff', file, hash, ignoreWhitespace: ignoreWs || undefined, fullContext: fullContext || undefined });

    const unsub = onMainEvent((msg) => {
      if (msg.type === 'fileDiff' && msg.file === file && msg.hash === hash
          && (msg.fullContext ?? false) === fullContext) {
        setDiffs(msg.data);
        setLoading(false);
      }
    });

    const timeout = setTimeout(() => {
      setLoading((prev) => {
        if (prev) setError(loc.diff.requestTimedOut);
        return false;
      });
    }, DIFF_TIMEOUT_MS);

    return () => { unsub(); clearTimeout(timeout); };
  }, [file, hash, ignoreWs, fullContext, enabled, loc]);

  return { diffs, loading, error };
}
