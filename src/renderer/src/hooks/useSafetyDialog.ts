import { useCallback, useRef, useState } from 'react';
import { postCommand } from '../api';
import {
  classToSeverity,
  shouldShowSafetyModal,
  type ErrorSeverity,
  type OperationSource,
} from '@core/errors/severity';
import type {
  GitErrorClass,
  PreflightIssue,
  RendererCommand,
  SavedOperationState,
  SuggestedAction,
} from '../types';
import type { SafetyDialogPayload } from '../features/safety';

interface EnqueueArgs {
  operation: string;
  errorClass: GitErrorClass;
  error: string;
  severity?: ErrorSeverity;
  source?: OperationSource;
  savedState?: SavedOperationState;
  preflightIssues?: PreflightIssue[];
  suggestedActions?: SuggestedAction[];
  /** Команда для retry — храним чтобы повторить последнюю операцию. */
  retryCommand?: RendererCommand;
}

export interface UseSafetyDialog {
  current: SafetyDialogPayload | null;
  enqueue(args: EnqueueArgs): void;
  shouldOpenModal(args: {
    errorClass?: GitErrorClass;
    severity?: ErrorSeverity;
    source?: OperationSource;
  }): boolean;
  onAction(action: SuggestedAction): void;
  close(): void;
}

/**
 * Очередь safety-диалогов FIFO. Если operationEnd прилетел во время
 * показа предыдущего — следующий ждёт. Renderer держит ОДИН диалог
 * за раз, иначе фокус-trap нативного <dialog> ломается.
 */
export function useSafetyDialog(): UseSafetyDialog {
  const [current, setCurrent] = useState<SafetyDialogPayload | null>(null);
  // FIFO ожидающих диалогов.
  const queueRef = useRef<Array<{ payload: SafetyDialogPayload; retryCommand?: RendererCommand }>>([]);
  const retryCommandRef = useRef<RendererCommand | null>(null);

  const showNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      setCurrent(null);
      retryCommandRef.current = null;
      return;
    }
    retryCommandRef.current = next.retryCommand ?? null;
    setCurrent(next.payload);
  }, []);

  const enqueue = useCallback((args: EnqueueArgs) => {
    const payload: SafetyDialogPayload = {
      operation: args.operation,
      errorClass: args.errorClass,
      error: args.error,
      savedState: args.savedState,
      preflightIssues: args.preflightIssues,
      suggestedActions: args.suggestedActions ?? [{ kind: 'cancel' }],
    };
    if (current) {
      queueRef.current.push({ payload, retryCommand: args.retryCommand });
      return;
    }
    retryCommandRef.current = args.retryCommand ?? null;
    setCurrent(payload);
  }, [current]);

  const close = useCallback(() => {
    showNext();
  }, [showNext]);

  const onAction = useCallback((action: SuggestedAction) => {
    const cmd = mapActionToCommand(action, retryCommandRef.current);
    if (cmd) postCommand(cmd);
    close();
  }, [close]);

  const shouldOpenModal = useCallback((args: {
    errorClass?: GitErrorClass;
    severity?: ErrorSeverity;
    source?: OperationSource;
  }) => {
    if (!args.errorClass) return false;
    const severity = args.severity ?? classToSeverity(args.errorClass);
    return shouldShowSafetyModal(args.source, severity);
  }, []);

  return { current, enqueue, shouldOpenModal, onAction, close };
}

/**
 * Маппинг `SuggestedAction.kind` → `RendererCommand`. Для retry
 * возвращаем сохранённую исходную команду; для cancel/ignore — null
 * (только закрытие).
 */
function mapActionToCommand(
  action: SuggestedAction,
  retryCommand: RendererCommand | null,
): RendererCommand | null {
  switch (action.kind) {
    case 'retry':
      return retryCommand;
    case 'restore_stash':
      return { type: 'stashPopIndex', index: action.payload.stashHash };
    case 'apply_stash_only':
      return { type: 'stashApply', index: action.payload.stashHash };
    case 'drop_stash':
      return { type: 'stashDrop', index: action.payload.stashHash };
    case 'kill_git_process':
      return { type: 'killGitProcess', pid: Number(action.payload.pid) };
    case 'remove_lock':
      return { type: 'removeIndexLock' };
    case 'rollback':
      return { type: 'rollbackOperation', journalEntryId: action.payload.journalEntryId };
    case 'abort_merge':
      return { type: 'abortMerge' };
    case 'continue_merge':
      return { type: 'completeMerge' };
    case 'abort_rebase':
      return { type: 'abortRebase' };
    case 'manual_continue':
    case 'ignore':
    case 'cancel':
      return null;
  }
}
