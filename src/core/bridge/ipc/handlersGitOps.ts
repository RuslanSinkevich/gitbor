import type { HandlerTable } from './types';
import {
  op,
  opWithPostMerge,
  errOnFail,
  mergeStateAfter,
  runTracked,
} from './helpers';

/** Удалённые операции Git + индекс + merge/rebase-команды с телом. */
export const ipcHandlersGitOps: HandlerTable = {
  checkout: op('checkout', (cmd, ctx) => ctx.ch.checkout(cmd.branch)),
  fetch: op('fetch', (cmd, ctx) => ctx.ch.fetch(cmd.remote)),
  pull: op('pull', (cmd, ctx) => ctx.ch.pull(cmd.rebase, cmd.autostash)),
  pullFrom: op('pull', (cmd, ctx) => ctx.ch.pullFrom(cmd.remote, cmd.branch, cmd.rebase, cmd.autostash)),
  push: op('push', (cmd, ctx) => ctx.ch.push(cmd.force, cmd.setUpstream)),
  pushTo: op('push', (cmd, ctx) => ctx.ch.push(cmd.force, cmd.setUpstream, cmd.remote, cmd.branch)),
  stash: op('stash', (cmd, ctx) => ctx.ch.stash(cmd.message)),
  stashPop: op('stashPop', (_cmd, ctx) => ctx.ch.stashPop()),
  merge: opWithPostMerge('merge', (cmd, ctx) =>
    ctx.ch.startMerge(cmd.branch, { noCommit: false, squash: false, ffOnly: false, noFf: false }),
  ),
  createBranch: op('createBranch', (cmd, ctx) => ctx.ch.createBranch(cmd.name, cmd.from)),
  cherryPick: op('cherry-pick', (cmd, ctx) => ctx.ch.cherryPick(cmd.hash)),
  revert: op('revert', (cmd, ctx) => ctx.ch.revert(cmd.hash)),
  resetTo: op('reset', (cmd, ctx) => ctx.ch.resetTo(cmd.hash, cmd.mode)),
  cloneRepo: op('clone', (cmd, ctx) => ctx.ch.cloneRepo(cmd.url, cmd.path)),
  initRepo: op('init', (cmd, ctx) => ctx.ch.initRepo(cmd.path)),
  addRemote: op('addRemote', (cmd, ctx) => ctx.ch.addRemote(cmd.name, cmd.url)),
  removeRemote: op('removeRemote', (cmd, ctx) => ctx.ch.removeRemote(cmd.name)),
  renameRemote: op('renameRemote', (cmd, ctx) => ctx.ch.renameRemote(cmd.oldName, cmd.newName)),
  submoduleUpdate: op('submoduleUpdate', (cmd, ctx) => ctx.ch.submoduleUpdate(cmd.path)),
  submoduleInit: op('submoduleInit', (cmd, ctx) => ctx.ch.submoduleInit(cmd.path)),
  rebaseTo: op('rebase', (cmd, ctx) => ctx.ch.rebaseTo(cmd.onto)),
  continueRebase: op('rebase', (_cmd, ctx) => ctx.ch.continueRebase()),
  skipRebase: op('rebase', (_cmd, ctx) => ctx.ch.skipRebase()),

  commit: opWithPostMerge('commit', (cmd, ctx) => ctx.ch.commit(cmd.message, cmd.amend)),

  renameBranch: errOnFail((cmd, ctx) => ctx.ch.renameBranch(cmd.oldName, cmd.newName), 'Rename failed'),
  deleteBranch: errOnFail((cmd, ctx) => ctx.ch.deleteBranch(cmd.branch, cmd.force), 'Delete failed'),
  createTag: errOnFail((cmd, ctx) => ctx.ch.createTag(cmd.name, cmd.ref, cmd.message), 'Create tag failed'),
  deleteTag: errOnFail((cmd, ctx) => ctx.ch.deleteTag(cmd.name, cmd.remote), 'Delete tag failed'),
  stashApply: errOnFail((cmd, ctx) => ctx.ch.stashApply(cmd.index), 'Stash apply failed'),
  stashDrop: errOnFail((cmd, ctx) => ctx.ch.stashDrop(cmd.index), 'Stash drop failed'),
  abortRebase: errOnFail((_cmd, ctx) => ctx.ch.abortRebase(), 'Abort rebase failed'),
  stageHunk: errOnFail((cmd, ctx) => ctx.ch.stageHunk(cmd.file, cmd.hunkIndex, !!cmd.reverse), 'Stage hunk failed'),
  stageLines: errOnFail(
    (cmd, ctx) => ctx.ch.stageLines(cmd.file, cmd.hunkIndex, cmd.lineIndices, !!cmd.reverse),
    'Stage lines failed',
  ),

  stashPopIndex: async (cmd, ctx) => {
    const applyResult = await ctx.ch.stashApply(cmd.index);
    if (applyResult.success) {
      const dropResult = await ctx.ch.stashDrop(cmd.index);
      if (!dropResult.success) ctx.send({ type: 'error', message: dropResult.error || 'Stash drop failed' });
    } else {
      ctx.send({ type: 'error', message: applyResult.error || 'Stash apply failed — stash preserved' });
    }
  },

  stashShow: async (cmd, ctx) => {
    const diffs = await ctx.ch.stashShow(cmd.index);
    ctx.send({ type: 'stashDiff', data: diffs, index: cmd.index });
  },

  saveAsPatch: async (cmd, ctx) => {
    const result = await ctx.ch.saveAsPatch(cmd.hash);
    if (!result.success) ctx.send({ type: 'error', message: result.error || 'Save patch failed' });
  },

  stageFile: async (cmd, ctx) => {
    await ctx.ch.stageFile(cmd.file);
  },
  stageAll: async (cmd, ctx) => {
    await ctx.ch.stageAll(cmd.files);
  },
  unstageFile: async (cmd, ctx) => {
    await ctx.ch.unstageFile(cmd.file);
  },
  unstageAll: async (cmd, ctx) => {
    await ctx.ch.unstageAll(cmd.files);
  },
  discardFileChanges: async (cmd, ctx) => {
    await ctx.ch.discardFileChanges(cmd.file);
  },
  deleteUntrackedFile: async (cmd, ctx) => {
    await ctx.ch.deleteUntrackedFile(cmd.file);
  },

  startMerge: async (cmd, ctx) => {
    const repoPath = ctx.sm.getState().repoPath || null;
    ctx.send({ type: 'operationStart', operation: 'merge', repoPath });
    const result = await runTracked('merge', ctx, () => ctx.ch.startMerge(cmd.source, cmd.options));
    ctx.send({ type: 'operationEnd', operation: 'merge', success: result.success, error: result.error, repoPath });
    const mergeState = await ctx.ch.getMergeState();
    if (mergeState.inProgress) ctx.send({ type: 'mergeState', data: mergeState });
  },

  resolveWithOurs: mergeStateAfter((cmd, ctx) => ctx.ch.resolveWithOurs(cmd.file)),
  resolveWithTheirs: mergeStateAfter((cmd, ctx) => ctx.ch.resolveWithTheirs(cmd.file)),
  resolveConflictRaw: mergeStateAfter((cmd, ctx) => ctx.ch.resolveConflictRaw(cmd.file, cmd.content)),
  getMergeState: mergeStateAfter(async () => {}),

  completeMerge: async (cmd, ctx) => {
    const result = await ctx.ch.completeMerge(cmd.message);
    if (result.success) {
      ctx.send({ type: 'mergeCompleted' });
    } else {
      ctx.send({ type: 'error', message: result.error || 'Complete merge failed' });
    }
  },
  abortMerge: async (_cmd, ctx) => {
    await ctx.ch.abortMerge();
    ctx.send({ type: 'mergeAborted' });
  },

  getConflictContent: async (cmd, ctx) => {
    const content = await ctx.ch.getConflictContent(cmd.file);
    ctx.send({ type: 'conflictContent', data: content });
  },
  predictConflicts: async (cmd, ctx) => {
    const files = await ctx.ch.predictConflicts(cmd.source, cmd.target);
    ctx.send({ type: 'predictedConflicts', files });
  },
};
