import { BrowserWindow, ipcMain } from 'electron';
import { CommandHandler } from '../commands/CommandHandler';
import { StateManager } from '../state/StateManager';
import { RendererCommand, MainEvent } from './messages';
import { getLang } from '../../main/i18n';

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

  private async handleCommand(command: RendererCommand): Promise<unknown> {
    try {
      switch (command.type) {
        case 'ready':
        case 'getState': {
          const state = this.stateManager.getState();
          this.send({ type: 'config', lang: getLang() });
          this.send({ type: 'fullState', data: state });
          return;
        }

        case 'getCommitDetails': {
          const detail = await this.commandHandler.getCommitDetails(command.hash);
          this.send({ type: 'commitDetails', data: detail, hash: command.hash });
          return;
        }

        case 'getGraphData': {
          const graphData = await this.commandHandler.getGraphData(command.maxCount);
          this.send({ type: 'graphData', data: graphData });
          return;
        }

        case 'getFileDiff': {
          try {
            const diffs = await this.commandHandler.getFileDiff(command.file, command.hash);
            this.send({ type: 'fileDiff', data: diffs, file: command.file, hash: command.hash });
          } catch (diffErr) {
            console.error('[SkyFork] getFileDiff error:', diffErr);
            this.send({ type: 'fileDiff', data: [], file: command.file, hash: command.hash });
            this.send({ type: 'error', message: diffErr instanceof Error ? diffErr.message : String(diffErr) });
          }
          return;
        }
        case 'getFileBlame': {
          const blame = await this.commandHandler.getFileBlame(command.file, command.hash);
          this.send({ type: 'fileBlame', data: blame, file: command.file });
          return;
        }
        case 'getFileHistory': {
          const history = await this.commandHandler.getFileHistory(command.file);
          this.send({ type: 'fileHistory', data: history, file: command.file });
          return;
        }

        case 'checkout': {
          this.send({ type: 'operationStart', operation: 'checkout' });
          const result = await this.commandHandler.checkout(command.branch);
          this.send({ type: 'operationEnd', operation: 'checkout', success: result.success, error: result.error });
          return;
        }

        case 'fetch': {
          this.send({ type: 'operationStart', operation: 'fetch' });
          const result = await this.commandHandler.fetch(command.remote);
          this.send({ type: 'operationEnd', operation: 'fetch', success: result.success, error: result.error });
          return;
        }

        case 'pull': {
          this.send({ type: 'operationStart', operation: 'pull' });
          const result = await this.commandHandler.pull(command.rebase);
          this.send({ type: 'operationEnd', operation: 'pull', success: result.success, error: result.error });
          return;
        }

        case 'push': {
          this.send({ type: 'operationStart', operation: 'push' });
          const result = await this.commandHandler.push(command.force, command.setUpstream);
          this.send({ type: 'operationEnd', operation: 'push', success: result.success, error: result.error });
          return;
        }

        case 'stash': {
          this.send({ type: 'operationStart', operation: 'stash' });
          const result = await this.commandHandler.stash(command.message);
          this.send({ type: 'operationEnd', operation: 'stash', success: result.success, error: result.error });
          return;
        }

        case 'stashPop': {
          this.send({ type: 'operationStart', operation: 'stashPop' });
          const result = await this.commandHandler.stashPop();
          this.send({ type: 'operationEnd', operation: 'stashPop', success: result.success, error: result.error });
          return;
        }

        case 'merge': {
          this.send({ type: 'operationStart', operation: 'merge' });
          const result = await this.commandHandler.merge(command.branch);
          this.send({ type: 'operationEnd', operation: 'merge', success: result.success, error: result.error });
          return;
        }

        case 'commit': {
          this.send({ type: 'operationStart', operation: 'commit' });
          const result = await this.commandHandler.commit(command.message, command.amend);
          this.send({ type: 'operationEnd', operation: 'commit', success: result.success, error: result.error });
          return;
        }

        case 'createBranch': {
          this.send({ type: 'operationStart', operation: 'createBranch' });
          const result = await this.commandHandler.createBranch(command.name, command.from);
          this.send({ type: 'operationEnd', operation: 'createBranch', success: result.success, error: result.error });
          return;
        }
        case 'renameBranch': {
          const result = await this.commandHandler.renameBranch(command.oldName, command.newName);
          if (!result.success) this.send({ type: 'error', message: result.error || 'Rename failed' });
          return;
        }
        case 'deleteBranch': {
          const result = await this.commandHandler.deleteBranch(command.branch, command.force);
          if (!result.success) this.send({ type: 'error', message: result.error || 'Delete failed' });
          return;
        }

        case 'createTag': {
          const result = await this.commandHandler.createTag(command.name, command.ref, command.message);
          if (!result.success) this.send({ type: 'error', message: result.error || 'Create tag failed' });
          return;
        }
        case 'deleteTag': {
          const result = await this.commandHandler.deleteTag(command.name, command.remote);
          if (!result.success) this.send({ type: 'error', message: result.error || 'Delete tag failed' });
          return;
        }

        case 'saveAsPatch': {
          await this.commandHandler.saveAsPatch(command.hash);
          return;
        }

        case 'cherryPick': {
          this.send({ type: 'operationStart', operation: 'cherry-pick' });
          const result = await this.commandHandler.cherryPick(command.hash);
          this.send({ type: 'operationEnd', operation: 'cherry-pick', success: result.success, error: result.error });
          return;
        }
        case 'revert': {
          this.send({ type: 'operationStart', operation: 'revert' });
          const result = await this.commandHandler.revert(command.hash);
          this.send({ type: 'operationEnd', operation: 'revert', success: result.success, error: result.error });
          return;
        }
        case 'resetTo': {
          this.send({ type: 'operationStart', operation: 'reset' });
          const result = await this.commandHandler.resetTo(command.hash, command.mode);
          this.send({ type: 'operationEnd', operation: 'reset', success: result.success, error: result.error });
          return;
        }

        case 'stashShow': {
          const diffs = await this.commandHandler.stashShow(command.index);
          this.send({ type: 'stashDiff', data: diffs, index: command.index });
          return;
        }

        case 'stashApply': {
          const result = await this.commandHandler.stashApply(command.index);
          if (!result.success) this.send({ type: 'error', message: result.error || 'Stash apply failed' });
          return;
        }
        case 'stashPopIndex': {
          const applyResult = await this.commandHandler.stashApply(command.index);
          if (applyResult.success) {
            const dropResult = await this.commandHandler.stashDrop(command.index);
            if (!dropResult.success) this.send({ type: 'error', message: dropResult.error || 'Stash drop failed' });
          } else {
            this.send({ type: 'error', message: applyResult.error || 'Stash apply failed — stash preserved' });
          }
          return;
        }
        case 'stashDrop': {
          const result = await this.commandHandler.stashDrop(command.index);
          if (!result.success) this.send({ type: 'error', message: result.error || 'Stash drop failed' });
          return;
        }

        case 'stageFile': {
          await this.commandHandler.stageFile(command.file);
          return;
        }
        case 'stageAll': {
          await this.commandHandler.stageAll(command.files);
          return;
        }
        case 'unstageFile': {
          await this.commandHandler.unstageFile(command.file);
          return;
        }
        case 'unstageAll': {
          await this.commandHandler.unstageAll(command.files);
          return;
        }
        case 'discardFileChanges': {
          await this.commandHandler.discardFileChanges(command.file);
          return;
        }
        case 'deleteUntrackedFile': {
          await this.commandHandler.deleteUntrackedFile(command.file);
          return;
        }

        case 'startMerge': {
          this.send({ type: 'operationStart', operation: 'merge' });
          const result = await this.commandHandler.startMerge(command.source, command.options);
          this.send({ type: 'operationEnd', operation: 'merge', success: result.success, error: result.error });
          const mergeState = await this.commandHandler.getMergeState();
          if (mergeState.inProgress) {
            this.send({ type: 'mergeState', data: mergeState });
          }
          return;
        }
        case 'resolveWithOurs': {
          await this.commandHandler.resolveWithOurs(command.file);
          const ms = await this.commandHandler.getMergeState();
          this.send({ type: 'mergeState', data: ms });
          return;
        }
        case 'resolveWithTheirs': {
          await this.commandHandler.resolveWithTheirs(command.file);
          const ms = await this.commandHandler.getMergeState();
          this.send({ type: 'mergeState', data: ms });
          return;
        }
        case 'completeMerge': {
          const result = await this.commandHandler.completeMerge(command.message);
          if (result.success) {
            this.send({ type: 'mergeCompleted' });
          } else {
            this.send({ type: 'error', message: result.error || 'Complete merge failed' });
          }
          return;
        }
        case 'abortMerge': {
          await this.commandHandler.abortMerge();
          this.send({ type: 'mergeAborted' });
          return;
        }
        case 'getConflictContent': {
          const content = this.commandHandler.getConflictContent(command.file);
          this.send({ type: 'conflictContent', data: content });
          return;
        }
        case 'resolveConflict': {
          await this.commandHandler.resolveConflict(command.file, command.resolutions);
          const ms = await this.commandHandler.getMergeState();
          this.send({ type: 'mergeState', data: ms });
          return;
        }
        case 'getMergeState': {
          const ms = await this.commandHandler.getMergeState();
          this.send({ type: 'mergeState', data: ms });
          return;
        }
        case 'predictConflicts': {
          const files = await this.commandHandler.predictConflicts(command.source, command.target);
          this.send({ type: 'predictedConflicts', files });
          return;
        }

        case 'openRepo':
          await this.commandHandler.openRepo(command.path);
          return;
        case 'openRepoDialog':
          await this.commandHandler.openRepoDialog();
          return;
        case 'cloneRepo': {
          this.send({ type: 'operationStart', operation: 'clone' });
          const result = await this.commandHandler.cloneRepo(command.url, command.path);
          this.send({ type: 'operationEnd', operation: 'clone', success: result.success, error: result.error });
          return;
        }
        case 'initRepo': {
          this.send({ type: 'operationStart', operation: 'init' });
          const result = await this.commandHandler.initRepo(command.path);
          this.send({ type: 'operationEnd', operation: 'init', success: result.success, error: result.error });
          return;
        }
        case 'closeRepo':
          await this.commandHandler.closeRepo(command.index);
          return;
        case 'switchRepo':
          await this.commandHandler.switchRepo(command.index);
          return;

        case 'addRemote': {
          this.send({ type: 'operationStart', operation: 'addRemote' });
          const r = await this.commandHandler.addRemote(command.name, command.url);
          this.send({ type: 'operationEnd', operation: 'addRemote', success: r.success, error: r.error });
          return;
        }
        case 'removeRemote': {
          this.send({ type: 'operationStart', operation: 'removeRemote' });
          const r = await this.commandHandler.removeRemote(command.name);
          this.send({ type: 'operationEnd', operation: 'removeRemote', success: r.success, error: r.error });
          return;
        }
        case 'renameRemote': {
          this.send({ type: 'operationStart', operation: 'renameRemote' });
          const r = await this.commandHandler.renameRemote(command.oldName, command.newName);
          this.send({ type: 'operationEnd', operation: 'renameRemote', success: r.success, error: r.error });
          return;
        }

        case 'stageHunk': {
          const r = await this.commandHandler.stageHunk(command.file, command.hunkIndex, !!command.reverse);
          if (!r.success) this.send({ type: 'error', message: r.error || 'Stage hunk failed' });
          return;
        }
        case 'stageLines': {
          const r = await this.commandHandler.stageLines(command.file, command.hunkIndex, command.lineIndices, !!command.reverse);
          if (!r.success) this.send({ type: 'error', message: r.error || 'Stage lines failed' });
          return;
        }

        case 'getSubmodules': {
          const subs = await this.commandHandler.getSubmodules();
          this.send({ type: 'submodules', data: subs });
          return;
        }
        case 'submoduleUpdate': {
          this.send({ type: 'operationStart', operation: 'submoduleUpdate' });
          const r = await this.commandHandler.submoduleUpdate(command.path);
          this.send({ type: 'operationEnd', operation: 'submoduleUpdate', success: r.success, error: r.error });
          return;
        }
        case 'submoduleInit': {
          this.send({ type: 'operationStart', operation: 'submoduleInit' });
          const r = await this.commandHandler.submoduleInit(command.path);
          this.send({ type: 'operationEnd', operation: 'submoduleInit', success: r.success, error: r.error });
          return;
        }

        case 'rebaseTo': {
          this.send({ type: 'operationStart', operation: 'rebase' });
          const result = await this.commandHandler.rebaseTo(command.onto);
          this.send({ type: 'operationEnd', operation: 'rebase', success: result.success, error: result.error });
          return;
        }

        case 'getRebaseTodo': {
          const todo = await this.commandHandler.getRebaseTodo(command.onto);
          this.send({ type: 'rebaseTodo', data: todo });
          return;
        }
        case 'executeRebase': {
          this.send({ type: 'operationStart', operation: 'rebase' });
          const result = await this.commandHandler.executeRebase(command.onto, command.entries);
          this.send({ type: 'operationEnd', operation: 'rebase', success: result.success, error: result.error });
          const progress = await this.commandHandler.getRebaseProgress();
          if (progress.inProgress) this.send({ type: 'rebaseProgress', data: progress });
          return;
        }
        case 'continueRebase': {
          this.send({ type: 'operationStart', operation: 'rebase' });
          const result = await this.commandHandler.continueRebase();
          this.send({ type: 'operationEnd', operation: 'rebase', success: result.success, error: result.error });
          return;
        }
        case 'abortRebase': {
          const result = await this.commandHandler.abortRebase();
          if (!result.success) this.send({ type: 'error', message: result.error || 'Abort rebase failed' });
          return;
        }
        case 'skipRebase': {
          this.send({ type: 'operationStart', operation: 'rebase' });
          const result = await this.commandHandler.skipRebase();
          this.send({ type: 'operationEnd', operation: 'rebase', success: result.success, error: result.error });
          return;
        }

        case 'openDiff': {
          const payload = this.commandHandler.getDiffPayload(command.file, command.hash);
          this.send({ type: 'openDiff', ...payload });
          return;
        }
        case 'openMergeEditor': {
          const payload = this.commandHandler.getFilePayload(command.file);
          this.send({ type: 'openMergeEditor', ...payload });
          return;
        }
        case 'openFile': {
          const payload = this.commandHandler.getFilePayload(command.file);
          this.send({ type: 'openFile', ...payload });
          return;
        }
        case 'switchView':
          this.send({ type: 'showView', view: command.view });
          return;

        default: {
          const unknownType = (command as { type: string }).type;
          this.send({ type: 'error', message: `Unknown command: ${unknownType}` });
          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.send({ type: 'error', message });
    }
  }
}
