import { dialog, BrowserWindow } from 'electron';
import { GitExecutor } from '../git/GitExecutor';
import { CommitDetail, CommitGraphData, FileDiff, BlameResult, FileHistoryResult, Submodule, RebaseTodoEntry, RebaseTodoList, RebaseProgress, MergeOptions, MergeResult, MergeState, OperationResult } from '../git/types';
import { RebaseManager } from '../git/RebaseManager';
import { ConflictManager } from './ConflictManager';
import { readConflictFile, buildResolvedContent, writeResolvedFile, type ConflictContent } from '../git/ConflictParser';
import { OperationQueue } from '../safety/OperationQueue';
import { SafetyNet } from '../safety/SafetyNet';
import { StateManager } from '../state/StateManager';
import * as Read from './readCommands';
import * as Write from './writeCommands';

export class CommandHandler {
  readonly conflicts: ConflictManager;
  readonly rebase: RebaseManager;

  constructor(
    private readonly git: GitExecutor,
    private readonly queue: OperationQueue,
    private readonly safety: SafetyNet,
    private readonly state: StateManager
  ) {
    this.conflicts = new ConflictManager(git, state);
    this.rebase = new RebaseManager(git);
  }

  // ─── Read ───
  getGraphData(maxCount: number): Promise<CommitGraphData> { return Read.getGraphData(this.queue, this.state, maxCount); }
  getCommitDetails(hash: string): Promise<CommitDetail> { return Read.getCommitDetails(this.queue, this.git, hash); }
  getFileDiff(file: string, hash: string): Promise<FileDiff[]> { return Read.getFileDiff(this.queue, this.git, file, hash); }
  getFileBlame(file: string, hash?: string): Promise<BlameResult> { return Read.getFileBlame(this.queue, this.git, file, hash); }
  getFileHistory(file: string): Promise<FileHistoryResult> { return Read.getFileHistory(this.queue, this.git, file); }
  getSubmodules(): Promise<Submodule[]> { return Read.getSubmodules(this.queue, this.git); }

  // ─── Write ───
  checkout(branch: string): Promise<OperationResult> { return Write.checkout(this.queue, this.git, this.safety, this.state, branch); }
  fetch(): Promise<OperationResult> { return Write.fetch(this.queue, this.git, this.state); }
  pull(): Promise<OperationResult> { return Write.pull(this.queue, this.git, this.safety, this.state); }
  push(): Promise<OperationResult> { return Write.push(this.queue, this.git, this.state); }
  stash(message?: string): Promise<OperationResult> { return Write.stash(this.queue, this.git, this.state, message); }
  stashPop(): Promise<OperationResult> { return Write.stashPop(this.queue, this.git, this.state); }
  merge(branch: string): Promise<OperationResult<MergeResult>> { return Write.merge(this.queue, this.git, this.safety, this.state, branch); }
  createBranch(name: string, from: string): Promise<OperationResult> { return Write.createBranch(this.queue, this.git, this.state, name, from); }
  renameBranch(oldName: string, newName: string): Promise<OperationResult> { return Write.renameBranch(this.queue, this.git, this.state, oldName, newName); }
  deleteBranch(branch: string, force?: boolean): Promise<OperationResult> { return Write.deleteBranch(this.queue, this.git, this.state, branch, force); }
  createTag(name: string, ref: string): Promise<OperationResult> { return Write.createTag(this.queue, this.git, this.state, name, ref); }
  deleteTag(name: string, remote?: boolean): Promise<OperationResult> { return Write.deleteTag(this.queue, this.git, this.state, name, remote); }
  cherryPick(hash: string): Promise<OperationResult> { return Write.cherryPick(this.queue, this.git, this.safety, this.state, hash); }
  revert(hash: string): Promise<OperationResult> { return Write.revert(this.queue, this.git, this.safety, this.state, hash); }
  resetTo(hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<OperationResult> { return Write.resetTo(this.queue, this.git, this.safety, this.state, hash, mode); }
  stashApply(index: string): Promise<OperationResult> { return Write.stashApply(this.queue, this.git, this.state, index); }
  stashDrop(index: string): Promise<OperationResult> { return Write.stashDrop(this.queue, this.git, this.state, index); }
  commit(message: string, amend?: boolean): Promise<OperationResult> { return Write.commit(this.queue, this.git, this.state, message, amend); }
  stageFile(file: string): Promise<OperationResult> { return Write.stageFile(this.queue, this.git, this.state, file); }
  unstageFile(file: string): Promise<OperationResult> { return Write.unstageFile(this.queue, this.git, this.state, file); }
  discardFileChanges(file: string): Promise<OperationResult> { return Write.discardFileChanges(this.queue, this.git, this.state, file); }

  cloneRepo(url: string, path: string): Promise<OperationResult> { return Write.cloneRepo(this.queue, this.git, this.state, url, path); }
  initRepo(path: string): Promise<OperationResult> { return Write.initRepo(this.queue, this.git, this.state, path); }

  // ─── Remote Management ───
  async addRemote(name: string, url: string): Promise<OperationResult> {
    return this.queue.enqueueWrite('addRemote', async () => {
      const r = await this.git.exec(['remote', 'add', name, url]);
      await this.state.refreshAll();
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined, rollbackAvailable: false };
    });
  }
  async removeRemote(name: string): Promise<OperationResult> {
    return this.queue.enqueueWrite('removeRemote', async () => {
      const r = await this.git.exec(['remote', 'remove', name]);
      await this.state.refreshAll();
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined, rollbackAvailable: false };
    });
  }
  async renameRemote(oldName: string, newName: string): Promise<OperationResult> {
    return this.queue.enqueueWrite('renameRemote', async () => {
      const r = await this.git.exec(['remote', 'rename', oldName, newName]);
      await this.state.refreshAll();
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined, rollbackAvailable: false };
    });
  }

  // ─── Stage Hunk/Lines ───
  stageHunk(file: string, hunkIndex: number, reverse: boolean): Promise<OperationResult> { return Write.stageHunk(this.queue, this.git, this.state, file, hunkIndex, reverse); }
  stageLines(file: string, hunkIndex: number, lineIndices: number[], reverse: boolean): Promise<OperationResult> { return Write.stageLines(this.queue, this.git, this.state, file, hunkIndex, lineIndices, reverse); }

  // ─── Submodules ───
  async submoduleUpdate(path: string): Promise<OperationResult> {
    return this.queue.enqueueWrite('submoduleUpdate', async () => {
      const r = await this.git.exec(['submodule', 'update', '--init', '--', path]);
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined, rollbackAvailable: false };
    });
  }
  async submoduleInit(path: string): Promise<OperationResult> {
    return this.queue.enqueueWrite('submoduleInit', async () => {
      const r = await this.git.exec(['submodule', 'init', '--', path]);
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined, rollbackAvailable: false };
    });
  }

  // ─── Rebase ───
  getRebaseTodo(onto: string): Promise<RebaseTodoList> { return this.queue.enqueueRead('getRebaseTodo', () => this.rebase.getTodoList(onto)); }
  getRebaseProgress(): Promise<RebaseProgress> { return this.queue.enqueueRead('getRebaseProgress', () => this.rebase.getProgress()); }
  async executeRebase(onto: string, entries: RebaseTodoEntry[]): Promise<OperationResult> {
    return this.queue.enqueueWrite('rebase', async () => {
      const result = await this.rebase.executeRebase(onto, entries);
      await this.state.refreshAll();
      return result;
    });
  }
  async continueRebase(): Promise<OperationResult> {
    return this.queue.enqueueWrite('rebaseContinue', async () => {
      const result = await this.rebase.continueRebase();
      await this.state.refreshAll();
      return result;
    });
  }
  async abortRebase(): Promise<OperationResult> {
    return this.queue.enqueueWrite('rebaseAbort', async () => {
      const result = await this.rebase.abortRebase();
      await this.state.refreshAll();
      return result;
    });
  }
  async skipRebase(): Promise<OperationResult> {
    return this.queue.enqueueWrite('rebaseSkip', async () => {
      const result = await this.rebase.skipRebase();
      await this.state.refreshAll();
      return result;
    });
  }

  // ─── Merge Conflict ───
  async startMerge(source: string, options: MergeOptions): Promise<OperationResult<MergeResult>> {
    return this.queue.enqueueWrite('merge', async () => {
      const result = await this.safety.wrapDestructive('merge', { source }, async () => this.conflicts.merge(source, options));
      await this.state.refreshAll();
      return result;
    });
  }

  async resolveWithOurs(file: string): Promise<void> {
    await this.queue.enqueueWrite('resolveOurs', async () => { await this.conflicts.resolveWithOurs(file); await this.state.refreshStatusAndNotify(); });
  }

  async resolveWithTheirs(file: string): Promise<void> {
    await this.queue.enqueueWrite('resolveTheirs', async () => { await this.conflicts.resolveWithTheirs(file); await this.state.refreshStatusAndNotify(); });
  }

  async completeMerge(message?: string): Promise<OperationResult> {
    return this.queue.enqueueWrite('completeMerge', async () => { const r = await this.conflicts.completeMerge(message); await this.state.refreshAll(); return r; });
  }

  async abortMerge(): Promise<void> {
    await this.queue.enqueueWrite('abortMerge', async () => { await this.conflicts.abortMerge(); await this.state.refreshAll(); });
  }

  getMergeState(): Promise<MergeState> {
    return this.queue.enqueueRead('getMergeState', () => this.conflicts.getMergeState());
  }

  getConflictContent(file: string): ConflictContent {
    const repoPath = this.state.getState().repoPath;
    return readConflictFile(repoPath, file);
  }

  async resolveConflict(file: string, resolutions: ('ours' | 'theirs')[]): Promise<void> {
    const repoPath = this.state.getState().repoPath;
    const parsed = readConflictFile(repoPath, file);
    const resolved = buildResolvedContent(parsed.blocks, resolutions);
    writeResolvedFile(repoPath, file, resolved);
    await this.git.exec(['add', file]);
    await this.state.refreshStatusAndNotify();
  }

  async predictConflicts(source: string, target: string): Promise<string[]> {
    return this.conflicts.predictConflicts(source, target);
  }

  // ─── Repo Management ───
  async openRepoDialog(): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Open Repository' });
    if (result.canceled || result.filePaths.length === 0) return null;
    await this.openRepo(result.filePaths[0]);
    return result.filePaths[0];
  }

  getDiffPayload(file: string, hash: string) { return { file, hash, repoPath: this.state.getState().repoPath }; }
  getFilePayload(file: string) { return { file, repoPath: this.state.getState().repoPath }; }

  async openRepo(repoPath: string): Promise<void> {
    const isGitRepo = await this.validateGitRepo(repoPath);
    if (!isGitRepo) {
      throw new Error(`"${repoPath}" is not a git repository`);
    }
    this.state.setRepoPath(repoPath);
    await this.state.switchRepo(repoPath);
  }

  async closeRepo(index: number): Promise<void> {
    const s = this.state.getState();
    if (index < 0 || index >= s.openRepos.length) return;
    const repos = [...s.openRepos];
    repos.splice(index, 1);
    this.state.setOpenRepos(repos);

    if (repos.length === 0) {
      this.state.clearRepo();
      return;
    }

    const nextIndex = Math.min(s.activeRepoIndex, repos.length - 1);
    await this.state.switchRepo(repos[nextIndex].path);
  }

  async switchRepo(index: number): Promise<void> {
    const s = this.state.getState();
    if (index < 0 || index >= s.openRepos.length) return;
    await this.state.switchRepo(s.openRepos[index].path);
  }

  private async validateGitRepo(repoPath: string): Promise<boolean> {
    try {
      const tempGit = new GitExecutor(repoPath);
      const result = await tempGit.exec(['rev-parse', '--git-dir']);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
