import type { HandlerTable } from './types';
import { handleReady } from './ready';
import { mainLogger } from '../../utils/Logger';

/** Жизненный цикл UI, чтение diff/blame/history. */
export const ipcHandlersState: HandlerTable = {
  ready: async (_cmd, ctx) => {
    await handleReady(ctx);
  },
  getState: async (_cmd, ctx) => {
    await handleReady(ctx);
  },
  refreshAll: async (_cmd, ctx) => {
    await ctx.sm.refreshAll();
    const state = ctx.sm.getState();
    ctx.send({ type: 'fullState', data: state });
  },
  refreshStatIndex: async (_cmd, ctx) => {
    await ctx.sm.refreshStatIndex();
  },
  restoreStatDirty: async (cmd, ctx) => {
    await ctx.sm.restoreStatDirtyFile(cmd.file);
  },

  getCommitDetails: async (cmd, ctx) => {
    const detail = await ctx.ch.getCommitDetails(cmd.hash);
    ctx.send({ type: 'commitDetails', data: detail, hash: cmd.hash });
  },
  getCommitTree: async (cmd, ctx) => {
    // Запрос-ответ через invoke (string[]): дерево привязано к активной
    // вкладке деталей, broadcast-событие тут лишнее.
    try {
      return await ctx.ch.getCommitTree(cmd.hash);
    } catch (err) {
      mainLogger.error(`getCommitTree: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  },
  getGraphData: async (cmd, ctx) => {
    const data = await ctx.ch.getGraphData(cmd.maxCount);
    ctx.send({ type: 'graphData', data, repoPath: ctx.sm.getState().repoPath });
  },
  getFileDiff: async (cmd, ctx) => {
    try {
      const diffs = await ctx.ch.getFileDiff(cmd.file, cmd.hash, cmd.ignoreWhitespace, cmd.fullContext);
      ctx.send({ type: 'fileDiff', data: diffs, file: cmd.file, hash: cmd.hash, fullContext: cmd.fullContext });
    } catch (diffErr) {
      mainLogger.error(`getFileDiff: ${diffErr instanceof Error ? (diffErr.stack ?? diffErr.message) : String(diffErr)}`);
      ctx.send({ type: 'fileDiff', data: [], file: cmd.file, hash: cmd.hash, fullContext: cmd.fullContext });
      ctx.send({ type: 'error', message: diffErr instanceof Error ? diffErr.message : String(diffErr) });
    }
  },
  getFileText: async (cmd, ctx) => {
    // Возвращаем результат через invoke (string | null), а не через event:
    // markdown preview всегда привязан к одной активной модалке, поэтому
    // request/response естественнее, чем broadcast.
    try {
      return await ctx.ch.getFileText(cmd.file, cmd.hash);
    } catch (err) {
      mainLogger.error(`getFileText: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  },
  getBranchesContaining: async (cmd, ctx) => {
    try {
      return await ctx.ch.getBranchesContaining(cmd.hash);
    } catch (err) {
      mainLogger.error(`getBranchesContaining: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  },
  getFileBlame: async (cmd, ctx) => {
    const blame = await ctx.ch.getFileBlame(cmd.file, cmd.hash);
    ctx.send({ type: 'fileBlame', data: blame, file: cmd.file });
  },
  getFileHistory: async (cmd, ctx) => {
    const history = await ctx.ch.getFileHistory(cmd.file);
    ctx.send({ type: 'fileHistory', data: history, file: cmd.file });
  },
};
