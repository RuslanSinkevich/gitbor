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
  getGraphData: async (cmd, ctx) => {
    const data = await ctx.ch.getGraphData(cmd.maxCount);
    ctx.send({ type: 'graphData', data, repoPath: ctx.sm.getState().repoPath });
  },
  getFileDiff: async (cmd, ctx) => {
    try {
      const diffs = await ctx.ch.getFileDiff(cmd.file, cmd.hash, cmd.ignoreWhitespace);
      ctx.send({ type: 'fileDiff', data: diffs, file: cmd.file, hash: cmd.hash });
    } catch (diffErr) {
      mainLogger.error(`getFileDiff: ${diffErr instanceof Error ? (diffErr.stack ?? diffErr.message) : String(diffErr)}`);
      ctx.send({ type: 'fileDiff', data: [], file: cmd.file, hash: cmd.hash });
      ctx.send({ type: 'error', message: diffErr instanceof Error ? diffErr.message : String(diffErr) });
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
