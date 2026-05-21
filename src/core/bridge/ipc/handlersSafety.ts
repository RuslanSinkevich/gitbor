import type { HandlerTable } from './types';
import { mainLogger } from '../../utils/Logger';

/**
 * Safety-handler'ы для команд `safetyResolve` / `killGitProcess` /
 * `removeIndexLock` / `rollbackOperation`.
 *
 * `safetyResolve` — единая точка ответа на `safetyIssue`. Renderer
 * присылает выбранное `RecoveryAction`, мы прокидываем в
 * RecoveryManager. Сам диалог-механизм (request/response) реализуется
 * через `requestId` — пока не задействован (пре-flight в рантайме
 * выкидывает OperationResult через operationEnd, а safetyIssue
 * зарезервирован для будущего интерактивного flow).
 */
export const ipcHandlersSafety: HandlerTable = {
  killGitProcess: async (cmd, ctx) => {
    try {
      const { RecoveryManager } = await import('../../safety/RecoveryManager');
      const { OperationJournal } = await import('../../safety/OperationJournal');
      const { join } = await import('path');
      const services = ctx.sm.getActiveServices();
      const journal = new OperationJournal(join(services.git.getCwd(), '.git'));
      const rm = new RecoveryManager(services.git, journal, services.safety);
      await rm.killGitProcess(cmd.pid);
      mainLogger.info(`safety: user killed git pid=${cmd.pid}`);
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },

  removeIndexLock: async (_cmd, ctx) => {
    try {
      const { unlinkSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const services = ctx.sm.getActiveServices();
      const lockPath = join(services.git.getCwd(), '.git', 'index.lock');
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
        mainLogger.info(`safety: user removed .git/index.lock`);
      }
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },

  rollbackOperation: async (cmd, ctx) => {
    try {
      const services = ctx.sm.getActiveServices();
      await services.safety.rollback(cmd.journalEntryId);
      await ctx.sm.refreshAll();
      mainLogger.info(`safety: user rolled back operation ${cmd.journalEntryId}`);
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },

  safetyResolve: async (cmd, ctx) => {
    try {
      const { RecoveryManager } = await import('../../safety/RecoveryManager');
      const { OperationJournal } = await import('../../safety/OperationJournal');
      const { join } = await import('path');
      const services = ctx.sm.getActiveServices();
      const journal = new OperationJournal(join(services.git.getCwd(), '.git'));
      const rm = new RecoveryManager(services.git, journal, services.safety);
      await rm.executeRecovery(cmd.action);
      await ctx.sm.refreshAll();
      mainLogger.info(`safety: resolved request=${cmd.requestId} action=${cmd.action.type}`);
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },
};
