import { useState, useCallback } from 'react';
import type { ErrorSeverity, OperationSource } from '../types';
import type {
  GitErrorClass,
  PreflightIssue,
  SavedOperationState,
  SuggestedAction,
} from '../types';

export interface OperationResult {
  operation: string;
  success: boolean;
  error?: string;
  errorClass?: GitErrorClass;
  savedState?: SavedOperationState;
  suggestedActions?: SuggestedAction[];
  preflightIssues?: PreflightIssue[];
  journalEntryId?: string;
  severity?: ErrorSeverity;
  source?: OperationSource;
  hookOutput?: string;
}

export interface EndOperationExtras {
  errorClass?: GitErrorClass;
  savedState?: SavedOperationState;
  suggestedActions?: SuggestedAction[];
  preflightIssues?: PreflightIssue[];
  journalEntryId?: string;
  severity?: ErrorSeverity;
  source?: OperationSource;
  hookOutput?: string;
}

export interface RunningOpsApi {
  runningOpsByRepo: Map<string, string>;
  lastOpResult: OperationResult | null;
  startOperation(repoPath: string | null | undefined, operation: string): void;
  endOperation(
    repoPath: string | null | undefined,
    operation: string,
    success: boolean,
    error?: string,
    extras?: EndOperationExtras,
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
    extras?: EndOperationExtras,
  ) => {
    const key = repoPath ?? '';
    setRunningOpsByRepo(prev => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setLastOpResult({
      operation,
      success,
      error,
      errorClass: extras?.errorClass,
      savedState: extras?.savedState,
      suggestedActions: extras?.suggestedActions,
      preflightIssues: extras?.preflightIssues,
      journalEntryId: extras?.journalEntryId,
      severity: extras?.severity,
      source: extras?.source,
      hookOutput: extras?.hookOutput,
    });
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
