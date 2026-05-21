import { useCallback, useRef, useState } from 'react';
import { postCommand } from '../api';
import type {
  GitErrorClass,
  PreflightIssue,
  RendererCommand,
  SavedOperationState,
  SuggestedAction,
} from '../types';
import type { SafetyDialogPayload } from '../features/safety';

const SUPPRESS_TOAST_CLASSES = new Set<GitErrorClass>([
  'lock_held', 'conflict', 'dirty_tree', 'merge_in_progress', 'rebase_in_progress',
  'cherry_pick_in_progress', 'revert_in_progress', 'unmerged_paths',
  'preflight_blocked', 'untracked_overwrite', 'non_fast_forward',
]);

interface EnqueueArgs {
  operation: string;
  errorClass: GitErrorClass;
  error: string;
  savedState?: SavedOperationState;
  preflightIssues?: PreflightIssue[];
  suggestedActions?: SuggestedAction[];
  /** Команда для retry — храним чтобы повторить последнюю операцию. */
  retryCommand?: RendererCommand;
}

export interface UseSafetyDialog {
  current: SafetyDialogPayload | null;
  enqueue(args: EnqueueArgs): void;
  shouldSuppressToast(errorClass: GitErrorClass | undefined): boolean;
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

  const shouldSuppressToast = useCallback((errorClass: GitErrorClass | undefined) => {
    if (!errorClass) return false;
    return SUPPRESS_TOAST_CLASSES.has(errorClass);
  }, []);

  return { current, enqueue, shouldSuppressToast, onAction, close };
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
