import type { HandlerTable } from './types';
import { AiError } from '../../ai/types';

/** AI-провайдер и генерация сообщений коммита. */
export const ipcHandlersAi: HandlerTable = {
  aiGetConfig: async (_cmd, ctx) => {
    if (!ctx.ai) {
      ctx.send({ type: 'aiConfig', config: null });
      return;
    }
    ctx.send({ type: 'aiConfig', config: ctx.ai.getConfig() });
  },

  aiSetConfig: async (cmd, ctx) => {
    if (!ctx.ai) return;
    try {
      await ctx.ai.setConfig(cmd.config);
      ctx.send({ type: 'aiConfig', config: ctx.ai.getConfig() });
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },

  aiTestConnection: async (cmd, ctx) => {
    if (!ctx.ai) {
      ctx.send({ type: 'aiTestResult', success: false, error: 'AI module unavailable' });
      return;
    }
    const res = await ctx.ai.testConnection(cmd.config);
    ctx.send({ type: 'aiTestResult', success: res.success, error: res.error });
  },

  aiGenerateCommitMessage: async (cmd, ctx) => {
    const requestId = cmd.requestId;
    if (!ctx.ai) {
      ctx.send({ type: 'aiError', requestId, message: 'AI module unavailable', kind: 'config' });
      return;
    }
    const repoPath = ctx.sm.getState().repoPath;
    if (!repoPath) {
      ctx.send({ type: 'aiError', requestId, message: 'No repository open', kind: 'config' });
      return;
    }
    let diff = '';
    try {
      const res = await ctx.sm.getGit().exec(['diff', '--cached', '--no-color'], { cwd: repoPath });
      diff = res.stdout ?? '';
    } catch (err) {
      ctx.send({
        type: 'aiError',
        requestId,
        message: err instanceof Error ? err.message : String(err),
        kind: 'config',
      });
      return;
    }
    if (!diff.trim()) {
      ctx.send({ type: 'aiError', requestId, message: 'Nothing is staged', kind: 'config' });
      return;
    }
    try {
      const { text, finishReason } = await ctx.ai.generateCommitMessage(requestId, diff, (delta) => {
        ctx.send({ type: 'aiChunk', requestId, delta });
      });
      ctx.send({ type: 'aiDone', requestId, text, finishReason });
    } catch (err) {
      const kind = err instanceof AiError ? err.kind : 'error';
      const message = err instanceof Error ? err.message : String(err);
      ctx.send({ type: 'aiError', requestId, message, kind });
    }
  },

  aiCancelGenerate: async (cmd, ctx) => {
    ctx.ai?.cancel(cmd.requestId);
  },
};
