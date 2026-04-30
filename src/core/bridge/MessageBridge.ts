import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { CommandHandler } from '../commands/CommandHandler';
import { StateManager } from '../state/StateManager';
import { RendererCommand, MainEvent } from './messages';
import { gitActivityStore } from '../activity/GitActivityStore';
import { runWithActivity } from '../activity/activityContext';
import { perfLog, approxJsonSize } from '../utils/perf';
import type { AiHandlers } from '../ai/AiHandlers';
import { AiError } from '../ai/types';

type CmdOf<K extends RendererCommand['type']> = Extract<RendererCommand, { type: K }>;

type HandlerTable = {
  [K in RendererCommand['type']]?: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void>;
};

interface HandlerContext {
  ch: CommandHandler;
  sm: StateManager;
  ai: AiHandlers | null;
  send: (event: MainEvent) => void;
}

async function runTracked<R extends { success: boolean; error?: string }>(
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

function op<K extends RendererCommand['type']>(
  operation: string,
  fn: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<{ success: boolean; error?: string }>,
): (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void> {
  return async (cmd, ctx) => {
    ctx.send({ type: 'operationStart', operation });
    const result = await runTracked(operation, ctx, () => fn(cmd, ctx));
    ctx.send({ type: 'operationEnd', operation, success: result.success, error: result.error });
  };
}

function opWithPostMerge<K extends RendererCommand['type']>(
  operation: string,
  fn: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<{ success: boolean; error?: string }>,
): (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void> {
  return async (cmd, ctx) => {
    ctx.send({ type: 'operationStart', operation });
    const result = await runTracked(operation, ctx, () => fn(cmd, ctx));
    ctx.send({ type: 'operationEnd', operation, success: result.success, error: result.error });
    const ms = await ctx.ch.getMergeState();
    ctx.send({ type: 'mergeState', data: ms });
  };
}

function errOnFail<K extends RendererCommand['type']>(
  fn: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<{ success: boolean; error?: string }>,
  fallbackMsg: string,
): (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void> {
  return async (cmd, ctx) => {
    const result = await fn(cmd, ctx);
    if (!result.success) ctx.send({ type: 'error', message: result.error || fallbackMsg });
  };
}

function mergeStateAfter<K extends RendererCommand['type']>(
  fn: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void>,
): (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void> {
  return async (cmd, ctx) => {
    await fn(cmd, ctx);
    const ms = await ctx.ch.getMergeState();
    ctx.send({ type: 'mergeState', data: ms });
  };
}

const handlers: HandlerTable = {
  ready: async (_cmd, ctx) => {
    const state = ctx.sm.getState();
    ctx.send({ type: 'config', lang: app.getLocale() });
    ctx.send({ type: 'fullState', data: state });
    if (state.repoPath) {
      const ms = await ctx.ch.getMergeState();
      if (ms.inProgress) ctx.send({ type: 'mergeState', data: ms });
    }
  },
  getState: async (_cmd, ctx) => {
    await handlers.ready!({ type: 'ready' }, ctx);
  },
  refreshAll: async (_cmd, ctx) => {
    await ctx.sm.refreshAll();
    const state = ctx.sm.getState();
    ctx.send({ type: 'fullState', data: state });
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
      console.error('[SkyFork] getFileDiff error:', diffErr);
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

  checkout:     op('checkout', (cmd, ctx) => ctx.ch.checkout(cmd.branch)),
  fetch:        op('fetch', (cmd, ctx) => ctx.ch.fetch(cmd.remote)),
  pull:         op('pull', (cmd, ctx) => ctx.ch.pull(cmd.rebase, cmd.autostash)),
  pullFrom:     op('pull', (cmd, ctx) => ctx.ch.pullFrom(cmd.remote, cmd.branch, cmd.rebase, cmd.autostash)),
  push:         op('push', (cmd, ctx) => ctx.ch.push(cmd.force, cmd.setUpstream)),
  pushTo:       op('push', (cmd, ctx) => ctx.ch.push(cmd.force, cmd.setUpstream, cmd.remote, cmd.branch)),
  stash:        op('stash', (cmd, ctx) => ctx.ch.stash(cmd.message)),
  stashPop:     op('stashPop', (_cmd, ctx) => ctx.ch.stashPop()),
  merge: opWithPostMerge('merge', (cmd, ctx) => ctx.ch.startMerge(cmd.branch, { noCommit: false, squash: false, ffOnly: false, noFf: false })),
  createBranch: op('createBranch', (cmd, ctx) => ctx.ch.createBranch(cmd.name, cmd.from)),
  cherryPick:   op('cherry-pick', (cmd, ctx) => ctx.ch.cherryPick(cmd.hash)),
  revert:       op('revert', (cmd, ctx) => ctx.ch.revert(cmd.hash)),
  resetTo:      op('reset', (cmd, ctx) => ctx.ch.resetTo(cmd.hash, cmd.mode)),
  cloneRepo:    op('clone', (cmd, ctx) => ctx.ch.cloneRepo(cmd.url, cmd.path)),
  initRepo:     op('init', (cmd, ctx) => ctx.ch.initRepo(cmd.path)),
  addRemote:    op('addRemote', (cmd, ctx) => ctx.ch.addRemote(cmd.name, cmd.url)),
  removeRemote: op('removeRemote', (cmd, ctx) => ctx.ch.removeRemote(cmd.name)),
  renameRemote: op('renameRemote', (cmd, ctx) => ctx.ch.renameRemote(cmd.oldName, cmd.newName)),
  submoduleUpdate: op('submoduleUpdate', (cmd, ctx) => ctx.ch.submoduleUpdate(cmd.path)),
  submoduleInit:   op('submoduleInit', (cmd, ctx) => ctx.ch.submoduleInit(cmd.path)),
  rebaseTo:        op('rebase', (cmd, ctx) => ctx.ch.rebaseTo(cmd.onto)),
  continueRebase:  op('rebase', (_cmd, ctx) => ctx.ch.continueRebase()),
  skipRebase:      op('rebase', (_cmd, ctx) => ctx.ch.skipRebase()),

  commit: opWithPostMerge('commit', (cmd, ctx) => ctx.ch.commit(cmd.message, cmd.amend)),

  renameBranch: errOnFail((cmd, ctx) => ctx.ch.renameBranch(cmd.oldName, cmd.newName), 'Rename failed'),
  deleteBranch: errOnFail((cmd, ctx) => ctx.ch.deleteBranch(cmd.branch, cmd.force), 'Delete failed'),
  createTag:    errOnFail((cmd, ctx) => ctx.ch.createTag(cmd.name, cmd.ref, cmd.message), 'Create tag failed'),
  deleteTag:    errOnFail((cmd, ctx) => ctx.ch.deleteTag(cmd.name, cmd.remote), 'Delete tag failed'),
  stashApply:   errOnFail((cmd, ctx) => ctx.ch.stashApply(cmd.index), 'Stash apply failed'),
  stashDrop:    errOnFail((cmd, ctx) => ctx.ch.stashDrop(cmd.index), 'Stash drop failed'),
  abortRebase:  errOnFail((_cmd, ctx) => ctx.ch.abortRebase(), 'Abort rebase failed'),
  stageHunk:    errOnFail((cmd, ctx) => ctx.ch.stageHunk(cmd.file, cmd.hunkIndex, !!cmd.reverse), 'Stage hunk failed'),
  stageLines:   errOnFail((cmd, ctx) => ctx.ch.stageLines(cmd.file, cmd.hunkIndex, cmd.lineIndices, !!cmd.reverse), 'Stage lines failed'),

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

  stageFile:           async (cmd, ctx) => { await ctx.ch.stageFile(cmd.file); },
  stageAll:            async (cmd, ctx) => { await ctx.ch.stageAll(cmd.files); },
  unstageFile:         async (cmd, ctx) => { await ctx.ch.unstageFile(cmd.file); },
  unstageAll:          async (cmd, ctx) => { await ctx.ch.unstageAll(cmd.files); },
  discardFileChanges:  async (cmd, ctx) => { await ctx.ch.discardFileChanges(cmd.file); },
  deleteUntrackedFile: async (cmd, ctx) => { await ctx.ch.deleteUntrackedFile(cmd.file); },

  startMerge: async (cmd, ctx) => {
    ctx.send({ type: 'operationStart', operation: 'merge' });
    const result = await runTracked('merge', ctx, () => ctx.ch.startMerge(cmd.source, cmd.options));
    ctx.send({ type: 'operationEnd', operation: 'merge', success: result.success, error: result.error });
    const mergeState = await ctx.ch.getMergeState();
    if (mergeState.inProgress) ctx.send({ type: 'mergeState', data: mergeState });
  },

  resolveWithOurs:   mergeStateAfter((cmd, ctx) => ctx.ch.resolveWithOurs(cmd.file)),
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

  getLfsStatus: async (_cmd, ctx) => {
    const data = await ctx.ch.getLfsStatus();
    ctx.send({ type: 'lfsStatus', data });
  },
  lfsTrack: async (cmd, ctx) => {
    await ctx.ch.lfsTrack(cmd.pattern);
    const data = await ctx.ch.getLfsStatus();
    ctx.send({ type: 'lfsStatus', data });
  },
  lfsUntrack: async (cmd, ctx) => {
    await ctx.ch.lfsUntrack(cmd.pattern);
    const data = await ctx.ch.getLfsStatus();
    ctx.send({ type: 'lfsStatus', data });
  },

  getWorktrees: async (_cmd, ctx) => {
    const data = await ctx.ch.getWorktrees();
    ctx.send({ type: 'worktrees', data });
  },
  addWorktree: async (cmd, ctx) => {
    await ctx.ch.addWorktree(cmd.path, cmd.branch, cmd.createBranch);
    const data = await ctx.ch.getWorktrees();
    ctx.send({ type: 'worktrees', data });
  },
  removeWorktree: async (cmd, ctx) => {
    try {
      await ctx.ch.removeWorktree(cmd.path, cmd.force);
      const data = await ctx.ch.getWorktrees();
      ctx.send({ type: 'worktrees', data });
    } catch (e: unknown) {
      ctx.send({ type: 'error', message: e instanceof Error ? e.message : 'Remove worktree failed' });
    }
  },

  getHooks: async (_cmd, ctx) => {
    const data = await ctx.ch.getHooks();
    ctx.send({ type: 'hooks', data });
  },
  toggleHook: async (cmd, ctx) => {
    await ctx.ch.toggleHook(cmd.name, cmd.enable);
    const data = await ctx.ch.getHooks();
    ctx.send({ type: 'hooks', data });
  },

  getGitignore: async (_cmd, ctx) => {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const gitignorePath = join(ctx.ch.getRepoPath(), '.gitignore');
    try {
      const content = await readFile(gitignorePath, 'utf-8');
      ctx.send({ type: 'gitignoreContent', data: content });
    } catch {
      ctx.send({ type: 'gitignoreContent', data: '' });
    }
  },

  writeGitignore: async (cmd, ctx) => {
    const { writeFile } = await import('fs/promises');
    const { join } = await import('path');
    const gitignorePath = join(ctx.ch.getRepoPath(), '.gitignore');
    await writeFile(gitignorePath, cmd.content, 'utf-8');
    ctx.send({ type: 'operationEnd', operation: 'writeGitignore', success: true });
  },

  getCommitDiff: async (cmd, ctx) => {
    const files = await ctx.ch.getCommitDiff(cmd.fromHash, cmd.toHash);
    ctx.send({ type: 'commitDiff', data: { fromHash: cmd.fromHash, toHash: cmd.toHash, files } });
  },

  getRepoStats: async (_cmd, ctx) => {
    const data = await ctx.ch.getRepoStats();
    ctx.send({ type: 'repoStats', data });
  },

  getDayCommits: async (cmd, ctx) => {
    const data = await ctx.ch.getDayCommits(cmd.author, cmd.date);
    ctx.send({ type: 'dayCommits', data });
  },

  getAuthorCodeStats: async (cmd, ctx) => {
    const data = await ctx.ch.getAuthorCodeStats(cmd.authorName, cmd.authorEmail, cmd.cacheOnly, cmd.force);
    ctx.send({ type: 'authorCodeStats', data });
  },

  getReflog: async (cmd, ctx) => {
    const data = await ctx.ch.getReflog(cmd.maxCount);
    ctx.send({ type: 'reflog', data });
  },
  restoreReflog: op('restoreReflog', (cmd, ctx) => ctx.ch.restoreReflog(cmd.hash)),

  bisectStart: async (cmd, ctx) => {
    const output = await ctx.ch.bisectStart(cmd.bad, cmd.good);
    ctx.send({ type: 'bisectOutput', output });
    const status = await ctx.ch.getBisectStatus();
    ctx.send({ type: 'bisectStatus', data: status });
  },
  bisectGood: async (_cmd, ctx) => {
    const output = await ctx.ch.bisectGood();
    ctx.send({ type: 'bisectOutput', output });
    const status = await ctx.ch.getBisectStatus();
    ctx.send({ type: 'bisectStatus', data: status });
  },
  bisectBad: async (_cmd, ctx) => {
    const output = await ctx.ch.bisectBad();
    ctx.send({ type: 'bisectOutput', output });
    const status = await ctx.ch.getBisectStatus();
    ctx.send({ type: 'bisectStatus', data: status });
  },
  bisectSkip: async (_cmd, ctx) => {
    const output = await ctx.ch.bisectSkip();
    ctx.send({ type: 'bisectOutput', output });
    const status = await ctx.ch.getBisectStatus();
    ctx.send({ type: 'bisectStatus', data: status });
  },
  bisectReset: async (_cmd, ctx) => {
    await ctx.ch.bisectReset();
    ctx.send({ type: 'bisectStatus', data: { active: false, current: '', stepsLeft: 0, goodCount: 0, badCount: 0, log: [] } });
  },
  getBisectStatus: async (_cmd, ctx) => {
    const status = await ctx.ch.getBisectStatus();
    ctx.send({ type: 'bisectStatus', data: status });
  },

  openRepo:       async (cmd, ctx) => { await ctx.ch.openRepo(cmd.path); },
  openRepoDialog: async (_cmd, ctx) => { await ctx.ch.openRepoDialog(); },
  closeRepo:      async (cmd, ctx) => { await ctx.ch.closeRepo(cmd.index); },
  switchRepo:     async (cmd, ctx) => { await ctx.ch.switchRepo(cmd.index); },

  getSubmodules: async (_cmd, ctx) => {
    const subs = await ctx.ch.getSubmodules();
    ctx.send({ type: 'submodules', data: subs });
  },

  getRebaseTodo: async (cmd, ctx) => {
    const todo = await ctx.ch.getRebaseTodo(cmd.onto);
    ctx.send({ type: 'rebaseTodo', data: todo });
  },
  executeRebase: async (cmd, ctx) => {
    ctx.send({ type: 'operationStart', operation: 'rebase' });
    const result = await runTracked('rebase', ctx, () => ctx.ch.executeRebase(cmd.onto, cmd.entries));
    ctx.send({ type: 'operationEnd', operation: 'rebase', success: result.success, error: result.error });
    const progress = await ctx.ch.getRebaseProgress();
    if (progress.inProgress) ctx.send({ type: 'rebaseProgress', data: progress });
  },

  getGitActivity: async (_cmd, ctx) => {
    ctx.send({ type: 'gitActivitySnapshot', data: gitActivityStore.getSnapshot() });
  },
  clearGitActivity: async (_cmd, ctx) => {
    gitActivityStore.clear();
    ctx.send({ type: 'gitActivitySnapshot', data: [] });
  },

  openDiff: async (cmd, ctx) => {
    const payload = ctx.ch.getDiffPayload(cmd.file, cmd.hash);
    ctx.send({ type: 'openDiff', ...payload });
  },
  openMergeEditor: async (cmd, ctx) => {
    const payload = ctx.ch.getFilePayload(cmd.file);
    ctx.send({ type: 'openMergeEditor', ...payload });
  },
  openFile: async (cmd, ctx) => {
    const { safePath } = await import('../utils/pathSecurity');
    const repoPath = ctx.sm.getState().repoPath;
    if (repoPath) {
      const fullPath = safePath(repoPath, cmd.file);
      shell.openPath(fullPath);
    }
  },
  switchView: async (cmd, ctx) => {
    ctx.send({ type: 'showView', view: cmd.view });
  },

  openInExplorer: async (_cmd, ctx) => {
    const repoPath = ctx.sm.getState().repoPath;
    if (repoPath) shell.openPath(repoPath);
  },
  openInTerminal: async (_cmd, ctx) => {
    const repoPath = ctx.sm.getState().repoPath;
    if (!repoPath) return;
    const { execFile, spawn } = await import('child_process');
    if (process.platform === 'win32') {
      execFile('cmd.exe', ['/K', `cd /d "${repoPath}"`], { cwd: repoPath, windowsHide: false });
    } else if (process.platform === 'darwin') {
      execFile('open', ['-a', 'Terminal', repoPath]);
    } else {
      const terminals = [
        { cmd: 'x-terminal-emulator', args: ['--working-directory', repoPath] },
        { cmd: 'gnome-terminal', args: ['--working-directory', repoPath] },
        { cmd: 'konsole', args: ['--workdir', repoPath] },
        { cmd: 'xfce4-terminal', args: ['--working-directory', repoPath] },
        { cmd: 'xterm', args: ['-e', 'bash'] },
      ];
      const tryTerminal = (index: number) => {
        if (index >= terminals.length) return;
        const t = terminals[index];
        const proc = spawn(t.cmd, t.args, { cwd: repoPath, detached: true, stdio: 'ignore' });
        proc.on('error', () => tryTerminal(index + 1));
        proc.unref();
      };
      tryTerminal(0);
    }
  },

  getRepoSettings: async (_cmd, ctx) => {
    const { GitConfig } = await import('../git/GitConfig');
    const config = new GitConfig(ctx.sm.getGit());
    const data = await config.getRepoSettings();
    ctx.send({ type: 'repoSettings', data });
  },
  setRepoSettings: async (cmd, ctx) => {
    const { GitConfig } = await import('../git/GitConfig');
    const config = new GitConfig(ctx.sm.getGit());
    try {
      await config.setRepoSettings({ useGlobal: cmd.useGlobal, name: cmd.name, email: cmd.email });
      const data = await config.getRepoSettings();
      ctx.send({ type: 'repoSettings', data });
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },

  listSshKeys: async (_cmd, ctx) => {
    const { listSshKeys } = await import('../ssh/SshKeyManager');
    const keys = await listSshKeys();
    ctx.send({ type: 'sshKeys', data: keys });
  },
  generateSshKey: async (cmd, ctx) => {
    const { generateSshKey, listSshKeys } = await import('../ssh/SshKeyManager');
    try {
      await generateSshKey({ name: cmd.name, type: cmd.keyType, passphrase: cmd.passphrase, comment: cmd.comment });
      const keys = await listSshKeys();
      ctx.send({ type: 'sshKeys', data: keys });
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },
  deleteSshKey: async (cmd, ctx) => {
    const { deleteSshKey, listSshKeys } = await import('../ssh/SshKeyManager');
    try {
      deleteSshKey(cmd.name);
      const keys = await listSshKeys();
      ctx.send({ type: 'sshKeys', data: keys });
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },
  getPublicKey: async (cmd, ctx) => {
    const { readPublicKey } = await import('../ssh/SshKeyManager');
    try {
      const content = readPublicKey(cmd.name);
      ctx.send({ type: 'publicKey', name: cmd.name, content });
    } catch (err) {
      ctx.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },

  // ─── AI ───

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

export class MessageBridge {
  private window: BrowserWindow | null = null;
  private unsubscribeState: (() => void) | null = null;
  private unsubscribeActivity: (() => void) | null = null;
  /**
   * Per-repo дедуп отправленного графа. Без него switchRepo A→B→A шлёт
   * весь graphData для каждого репо на каждое переключение (в MainProcess
   * applyRepoSnapshot создаёт «новую» ссылку, хотя данные идентичны).
   * При быстром туда-сюда 3-10 MB JSON'а в IPC-очереди накапливаются
   * и видятся пользователем как «тормоз» — IPC backlog блокирует
   * следующие сообщения. Храним пары commits/layout по repoPath;
   * если пришёл notify с тем же reference что мы уже слали для этого
   * репо — не шлём повторно. Renderer уже имеет данные в repoUiCache.
   */
  private sentGraphByRepo = new Map<string, {
    commits: ReturnType<StateManager['getState']>['commits'];
    layout: ReturnType<StateManager['getState']>['graphLayout'];
  }>();

  constructor(
    private readonly commandHandler: CommandHandler,
    private readonly stateManager: StateManager,
    private readonly aiHandlers: AiHandlers | null = null,
  ) {}

  attach(win: BrowserWindow): void {
    this.window = win;

    this.unsubscribeActivity = gitActivityStore.subscribe(event => {
      if (event.type === 'added') {
        this.send({ type: 'gitActivityAdded', entry: event.entry });
      } else if (event.type === 'updated') {
        this.send({ type: 'gitActivityUpdated', entry: event.entry });
      } else if (event.type === 'cleared') {
        this.send({ type: 'gitActivityCleared' });
      }
    });

    this.unsubscribeState = this.stateManager.subscribe(state => {
      const { commits, graphLayout, ...lightState } = state;
      this.send({ type: 'stateUpdate', data: lightState });

      const repoPath = state.repoPath;
      if (!repoPath) return;

      // Дедуп по repoPath: если для этого репо мы уже слали ровно эти
      // ссылки на commits/layout — не гоним 3-10 MB снова через IPC.
      const sent = this.sentGraphByRepo.get(repoPath);
      if (sent && sent.commits === commits && sent.layout === graphLayout) {
        return;
      }
      this.sentGraphByRepo.set(repoPath, { commits, layout: graphLayout });

      const payload: MainEvent = {
        type: 'graphData',
        data: { commits, layout: graphLayout },
        repoPath,
      };
      const size = approxJsonSize(payload.data);
      perfLog('IPC.graphData.send', {
        repo: repoPath,
        commits: commits.length,
        nodes: graphLayout.nodes.length,
        bytes: size,
        mb: (size / 1024 / 1024).toFixed(2),
      });
      this.send(payload);
    });

    ipcMain.handle('skyfork:command', (_event, command: unknown) => {
      return this.handleCommand(command);
    });

    win.on('closed', () => {
      this.dispose();
    });
  }

  send(event: MainEvent): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('skyfork:event', event);
    }
  }

  /**
   * Освободить ссылки на данные закрытого репо и сообщить renderer,
   * чтобы тот очистил свой repoUiCache. Без этого — утечка массивов
   * commits/layout на сессию (минорно, но для долгих сессий копится).
   */
  cleanupRepo(closedPath: string): void {
    this.sentGraphByRepo.delete(closedPath);
    this.send({ type: 'repoClosed', path: closedPath });
  }

  dispose(): void {
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }
    if (this.unsubscribeActivity) {
      this.unsubscribeActivity();
      this.unsubscribeActivity = null;
    }
    this.aiHandlers?.cancelAll();
    ipcMain.removeHandler('skyfork:command');
    this.sentGraphByRepo.clear();
    this.window = null;
  }

  private async handleCommand(command: unknown): Promise<void> {
    try {
      if (!command || typeof command !== 'object' || !('type' in command) || typeof (command as Record<string, unknown>).type !== 'string') {
        this.send({ type: 'error', message: 'Invalid command: missing or non-string type field' });
        return;
      }
      const cmd = command as RendererCommand;
      type AnyHandler = (cmd: RendererCommand, ctx: HandlerContext) => Promise<void>;
      const handler = handlers[cmd.type] as AnyHandler | undefined;
      if (handler) {
        await handler(cmd, {
          ch: this.commandHandler,
          sm: this.stateManager,
          ai: this.aiHandlers,
          send: e => this.send(e),
        });
      } else {
        this.send({ type: 'error', message: `Unknown command: ${cmd.type}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.send({ type: 'error', message });
    }
  }
}
