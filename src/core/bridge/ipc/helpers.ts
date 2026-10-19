import { gitActivityStore } from '../../activity/GitActivityStore';
import { runWithActivity } from '../../activity/activityContext';
import { classToSeverity, normalizeSource, type OperationSource } from '../../errors/severity';
import type { RendererCommand } from '../messages';
import type { HandlerContext, CmdOf } from './types';
import type { ErrorSeverity } from '../../errors/severity';
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
  severity?: ErrorSeverity;
  source?: OperationSource;
  hookOutput?: string;
}

function commandSource(cmd: RendererCommand): OperationSource {
  return normalizeSource(cmd.opSource);
}

function attachOpMeta(result: ExtendedOpResult, source: OperationSource): ExtendedOpResult {
  if (result.success || !result.errorClass) {
    return { ...result, source };
  }
  const severity = result.severity ?? classToSeverity(result.errorClass);
  return { ...result, source, severity };
}

export async function runTracked<R extends ExtendedOpResult>(
  operation: string,
  ctx: HandlerContext,
  work: () => Promise<R>,
  source: OperationSource = 'user',
): Promise<R> {
  const repoPath = ctx.sm.getState().repoPath || null;
  const activityId = gitActivityStore.start(operation, repoPath, source);
  try {
    const result = await runWithActivity(activityId, work);
    const enriched = attachOpMeta(result, source);
    gitActivityStore.finish(activityId, enriched.success, enriched.error, {
      severity: enriched.severity,
      source: enriched.source,
      errorClass: enriched.errorClass,
    });
    return enriched as R;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    gitActivityStore.finish(activityId, false, msg, { source });
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
    const source = commandSource(cmd);
    const result = attachOpMeta(await runTracked(operation, ctx, () => fn(cmd, ctx), source), source);
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
      severity: result.severity,
      source: result.source,
      hookOutput: result.hookOutput,
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
    const source = commandSource(cmd);
    const result = attachOpMeta(await runTracked(operation, ctx, () => fn(cmd, ctx), source), source);
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
      severity: result.severity,
      source: result.source,
      hookOutput: result.hookOutput,
    });
    if (repoPath) {
      const ms = await ctx.ch.getMergeStateForRepo(repoPath);
      ctx.send({ type: 'mergeState', data: ms, repoPath });
    }
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
    const repoPath = ctx.sm.getState().repoPath || null;
    // finally: и при ошибке (её покажет общий обработчик) баннер/список
    // конфликтов должны увидеть реальное состояние.
    try {
      await fn(cmd, ctx);
    } finally {
      if (repoPath) {
        const ms = await ctx.ch.getMergeStateForRepo(repoPath);
        ctx.send({ type: 'mergeState', data: ms, repoPath });
      }
    }
  };
}
