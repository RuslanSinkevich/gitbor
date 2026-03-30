import { useState, useCallback } from 'react';

export interface DiffTarget {
  file: string;
  hash: string;
}

export function useDiffState() {
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);

  const openDiff = useCallback((file: string, hash: string) => {
    setDiffTarget({ file, hash });
  }, []);

  const closeDiff = useCallback(() => {
    setDiffTarget(null);
  }, []);

  return { diffTarget, openDiff, closeDiff };
}
