import { useState, useCallback } from 'react';

export interface OperationResult { operation: string; success: boolean; error?: string }

export interface RunningOpsApi {
  runningOpsByRepo: Map<string, string>;
  lastOpResult: OperationResult | null;
  startOperation(repoPath: string | null | undefined, operation: string): void;
  endOperation(
    repoPath: string | null | undefined,
    operation: string,
    success: boolean,
    error?: string,
  ): void;
  /** Очистить running-флаг по репо (репо закрылось с зависшей операцией). */
  removeRepo(repoPath: string): void;
  clearLastResult(): void;
  /** Вернуть текущую операцию для активного пути (или null). */
  getCurrentOp(activeRepoPath: string): string | null;
}

/**
 * Per-repo карта активных операций. `state.isOperationRunning` UI берёт
 * только по активной вкладке: соседние fetch/push не блокируют кнопки тут.
 * Ключ `''` (пустая строка) = операция без репо (clone/init до открытия
 * результата).
 */
export function useRunningOps(): RunningOpsApi {
  const [runningOpsByRepo, setRunningOpsByRepo] = useState<Map<string, string>>(() => new Map());
  const [lastOpResult, setLastOpResult] = useState<OperationResult | null>(null);

  const startOperation = useCallback((repoPath: string | null | undefined, operation: string) => {
    const key = repoPath ?? '';
    setRunningOpsByRepo(prev => {
      const next = new Map(prev);
      next.set(key, operation);
      return next;
    });
  }, []);

  const endOperation = useCallback((
    repoPath: string | null | undefined,
    operation: string,
    success: boolean,
    error?: string,
  ) => {
    const key = repoPath ?? '';
    setRunningOpsByRepo(prev => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setLastOpResult({ operation, success, error });
  }, []);

  const removeRepo = useCallback((repoPath: string) => {
    setRunningOpsByRepo(prev => {
      if (!prev.has(repoPath)) return prev;
      const out = new Map(prev);
      out.delete(repoPath);
      return out;
    });
  }, []);

  const clearLastResult = useCallback(() => setLastOpResult(null), []);

  const getCurrentOp = useCallback((activeRepoPath: string): string | null => {
    if (!activeRepoPath) return null;
    return runningOpsByRepo.get(activeRepoPath) ?? null;
  }, [runningOpsByRepo]);

  return {
    runningOpsByRepo,
    lastOpResult,
    startOperation,
    endOperation,
    removeRepo,
    clearLastResult,
    getCurrentOp,
  };
}
