import { app } from 'electron';
import type { HandlerContext } from './types';

/** Первичная синхронизация renderer ↔ main (локаль, полный state, merge). */
export async function handleReady(ctx: HandlerContext): Promise<void> {
  const state = ctx.sm.getState();
  ctx.send({ type: 'config', lang: app.getLocale() });
  ctx.send({ type: 'fullState', data: state });
  if (state.repoPath) {
    const ms = await ctx.ch.getMergeStateForRepo(state.repoPath);
    if (ms.inProgress) ctx.send({ type: 'mergeState', data: ms, repoPath: state.repoPath });
  }
}
