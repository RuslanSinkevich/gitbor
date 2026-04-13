import { BrowserWindow, ipcMain } from 'electron';
import { CommandHandler } from '../commands/CommandHandler';
import { StateManager } from '../state/StateManager';
import { RendererCommand, MainEvent } from './messages';
import { getLang } from '../../main/i18n';

type CmdOf<K extends RendererCommand['type']> = Extract<RendererCommand, { type: K }>;

type HandlerTable = {
  [K in RendererCommand['type']]?: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void>;
};

interface HandlerContext {
  ch: CommandHandler;
  sm: StateManager;
  send: (event: MainEvent) => void;
}

function op<K extends RendererCommand['type']>(
  operation: string,
  fn: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<{ success: boolean; error?: string }>,
): (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void> {
  return async (cmd, ctx) => {
    ctx.send({ type: 'operationStart', operation });
    const result = await fn(cmd, ctx);
    ctx.send({ type: 'operationEnd', operation, success: result.success, error: result.error });
  };
}

function opWithPostMerge<K extends RendererCommand['type']>(
  operation: string,
  fn: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<{ success: boolean; error?: string }>,
): (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void> {
  return async (cmd, ctx) => {
    ctx.send({ type: 'operationStart', operation });
    const result = await fn(cmd, ctx);
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
    ctx.send({ type: 'config', lang: getLang() });
    ctx.send({ type: 'fullState', data: state });
  },
  getState: async (_cmd, ctx) => {
    const state = ctx.sm.getState();
    ctx.send({ type: 'config', lang: getLang() });
    ctx.send({ type: 'fullState', data: state });
  },

  getCommitDetails: async (cmd, ctx) => {
    const detail = await ctx.ch.getCommitDetails(cmd.hash);
    ctx.send({ type: 'commitDetails', data: detail, hash: cmd.hash });
  },
  getGraphData: async (cmd, ctx) => {
    const data = await ctx.ch.getGraphData(cmd.maxCount);
    ctx.send({ type: 'graphData', data });
  },
  getFileDiff: async (cmd, ctx) => {
    try {
      const diffs = await ctx.ch.getFileDiff(cmd.file, cmd.hash);
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
  pull:         op('pull', (cmd, ctx) => ctx.ch.pull(cmd.rebase)),
  push:         op('push', (cmd, ctx) => ctx.ch.push(cmd.force, cmd.setUpstream)),
  stash:        op('stash', (cmd, ctx) => ctx.ch.stash(cmd.message)),
  stashPop:     op('stashPop', (_cmd, ctx) => ctx.ch.stashPop()),
  merge:        op('merge', (cmd, ctx) => ctx.ch.merge(cmd.branch)),
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

  saveAsPatch: async (cmd, ctx) => { await ctx.ch.saveAsPatch(cmd.hash); },

  stageFile:           async (cmd, ctx) => { await ctx.ch.stageFile(cmd.file); },
  stageAll:            async (cmd, ctx) => { await ctx.ch.stageAll(cmd.files); },
  unstageFile:         async (cmd, ctx) => { await ctx.ch.unstageFile(cmd.file); },
  unstageAll:          async (cmd, ctx) => { await ctx.ch.unstageAll(cmd.files); },
  discardFileChanges:  async (cmd, ctx) => { await ctx.ch.discardFileChanges(cmd.file); },
  deleteUntrackedFile: async (cmd, ctx) => { await ctx.ch.deleteUntrackedFile(cmd.file); },

  startMerge: async (cmd, ctx) => {
    ctx.send({ type: 'operationStart', operation: 'merge' });
    const result = await ctx.ch.startMerge(cmd.source, cmd.options);
    ctx.send({ type: 'operationEnd', operation: 'merge', success: result.success, error: result.error });
    const mergeState = await ctx.ch.getMergeState();
    if (mergeState.inProgress) ctx.send({ type: 'mergeState', data: mergeState });
  },

  resolveWithOurs:   mergeStateAfter((cmd, ctx) => ctx.ch.resolveWithOurs(cmd.file)),
  resolveWithTheirs: mergeStateAfter((cmd, ctx) => ctx.ch.resolveWithTheirs(cmd.file)),
  resolveConflict:   mergeStateAfter((cmd, ctx) => ctx.ch.resolveConflict(cmd.file, cmd.resolutions)),
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
    const result = await ctx.ch.executeRebase(cmd.onto, cmd.entries);
    ctx.send({ type: 'operationEnd', operation: 'rebase', success: result.success, error: result.error });
    const progress = await ctx.ch.getRebaseProgress();
    if (progress.inProgress) ctx.send({ type: 'rebaseProgress', data: progress });
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
    const payload = ctx.ch.getFilePayload(cmd.file);
    ctx.send({ type: 'openFile', ...payload });
  },
  switchView: async (cmd, ctx) => {
    ctx.send({ type: 'showView', view: cmd.view });
  },
};

export class MessageBridge {
  private window: BrowserWindow | null = null;
  private unsubscribeState: (() => void) | null = null;

  constructor(
    private readonly commandHandler: CommandHandler,
    private readonly stateManager: StateManager
  ) {}

  attach(win: BrowserWindow): void {
    this.window = win;

    this.unsubscribeState = this.stateManager.subscribe(state => {
      this.send({ type: 'stateUpdate', data: state });
    });

    ipcMain.handle('skyfork:command', (_event, command: RendererCommand) => {
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

  dispose(): void {
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }
    ipcMain.removeHandler('skyfork:command');
    this.window = null;
  }

  private async handleCommand(command: RendererCommand): Promise<void> {
    try {
      type AnyHandler = (cmd: RendererCommand, ctx: HandlerContext) => Promise<void>;
      const handler = handlers[command.type] as AnyHandler | undefined;
      if (handler) {
        await handler(command, { ch: this.commandHandler, sm: this.stateManager, send: e => this.send(e) });
      } else {
        this.send({ type: 'error', message: `Unknown command: ${(command as { type: string }).type}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.send({ type: 'error', message });
    }
  }
}
