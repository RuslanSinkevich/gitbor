import { gitActivityStore } from '../../activity/GitActivityStore';
import { runWithActivity } from '../../activity/activityContext';
import type { RendererCommand } from '../messages';
import type { HandlerContext, CmdOf } from './types';
import type {
  GitErrorClass,
  PreflightIssue,
  SavedOperationState,
  SuggestedAction,
} from '../../git/types';

/**
 * Расширенный результат операции, который helpers пробрасывают в IPC.
 * Совместим с прежним `{success, error}` (новые поля опциональны).
 */
export interface ExtendedOpResult {
  success: boolean;
  error?: string;
  errorClass?: GitErrorClass;
  savedState?: SavedOperationState;
  suggestedActions?: SuggestedAction[];
  preflightIssues?: PreflightIssue[];
  journalEntryId?: string;
}

export async function runTracked<R extends { success: boolean; error?: string }>(
  operation: string,
  ctx: HandlerContext,
  work: () => Promise<R>,
): Promise<R> {
  const repoPath = ctx.sm.getState().repoPath || null;
  const activityId = gitActivityStore.start(operation, repoPath);
  try {
    const result = await runWithActivity(activityId, work);
    gitActivityStore.finish(activityId, result.success, result.error);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    gitActivityStore.finish(activityId, false, msg);
    throw err;
  }
}

export function op<K extends RendererCommand['type']>(
  operation: string,
  fn: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<ExtendedOpResult>,
): (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void> {
  return async (cmd, ctx) => {
    // Снимок repoPath ДО старта: иначе при переключении вкладки между
    // start и end событие end уйдёт с другим репо, и renderer
    // не очистит running-флаг на исходном.
    const repoPath = ctx.sm.getState().repoPath || null;
    ctx.send({ type: 'operationStart', operation, repoPath });
    const result = await runTracked(operation, ctx, () => fn(cmd, ctx));
    ctx.send({
      type: 'operationEnd',
      operation,
      success: result.success,
      error: result.error,
      repoPath,
      errorClass: result.errorClass,
      savedState: result.savedState,
      suggestedActions: result.suggestedActions,
      preflightIssues: result.preflightIssues,
      journalEntryId: result.journalEntryId,
    });
  };
}

export function opWithPostMerge<K extends RendererCommand['type']>(
  operation: string,
  fn: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<ExtendedOpResult>,
): (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void> {
  return async (cmd, ctx) => {
    const repoPath = ctx.sm.getState().repoPath || null;
    ctx.send({ type: 'operationStart', operation, repoPath });
    const result = await runTracked(operation, ctx, () => fn(cmd, ctx));
    ctx.send({
      type: 'operationEnd',
      operation,
      success: result.success,
      error: result.error,
      repoPath,
      errorClass: result.errorClass,
      savedState: result.savedState,
      suggestedActions: result.suggestedActions,
      preflightIssues: result.preflightIssues,
      journalEntryId: result.journalEntryId,
    });
    const ms = await ctx.ch.getMergeState();
    ctx.send({ type: 'mergeState', data: ms });
  };
}

export function errOnFail<K extends RendererCommand['type']>(
  fn: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<{ success: boolean; error?: string }>,
  fallbackMsg: string,
): (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void> {
  return async (cmd, ctx) => {
    const result = await fn(cmd, ctx);
    if (!result.success) ctx.send({ type: 'error', message: result.error || fallbackMsg });
  };
}

export function mergeStateAfter<K extends RendererCommand['type']>(
  fn: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void>,
): (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void> {
  return async (cmd, ctx) => {
    await fn(cmd, ctx);
    const ms = await ctx.ch.getMergeState();
    ctx.send({ type: 'mergeState', data: ms });
  };
}
