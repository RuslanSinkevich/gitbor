import { dialog, BrowserWindow } from 'electron';
import { GitExecutor } from '../git/GitExecutor';
import { CommitDetail, CommitGraphData, FileDiff, BlameResult, FileHistoryResult, Submodule, RebaseTodoEntry, RebaseTodoList, RebaseProgress, MergeOptions, MergeResult, MergeState, OperationResult, ReflogEntry, FileChange } from '../git/types';
import type { RepoStats, DayCommitEntry, AuthorCodeStatsResult } from '../bridge/messages';
import { RebaseManager } from '../git/RebaseManager';
import { BisectManager, type BisectStatus } from '../git/BisectManager';
import { HooksManager, type HookInfo } from '../git/HooksManager';
import { WorktreeManager, type WorktreeInfo } from '../git/WorktreeManager';
import { LfsManager, type LfsStatus } from '../git/LfsManager';
import { ConflictManager } from './ConflictManager';
import { readConflictFile, writeResolvedFile, type ConflictContent } from '../git/ConflictParser';
import { OperationQueue } from '../safety/OperationQueue';
import { SafetyNet } from '../safety/SafetyNet';
import { StateManager } from '../state/StateManager';
import { AppError } from '../utils/AppError';
import * as Read from './readCommands';
import * as Write from './writeCommands';

/**
 * `CommandHandler` стал тонкой обёрткой над активным репо. Все исполнители
 * (git/queue/safety и менеджеры RebaseManager/ConflictManager и т.п.)
 * берутся per-call через `state.getActiveServices()`. Это значит:
 *
 * - длинная команда репо A не блокирует репо B (у них разные `OperationQueue`);
 * - smena активного репо не «запутывает» уже выполняющиеся команды —
 *   каждая команда захватила свои `git`/`queue`/`safety` локально.
 */
export class CommandHandler {
  constructor(private readonly state: StateManager) {}

  // ─── Active services accessors ───
  private get git(): GitExecutor { return this.state.getActiveServices().git; }
  private get queue(): OperationQueue { return this.state.getActiveServices().queue; }
  private get safety(): SafetyNet { return this.state.getActiveServices().safety; }
  private servicesFor(repoPath: string) { return this.state.getRegistry().acquire(repoPath); }

  // Менеджеры — stateless обёртки над активным `git`. Создаются на запрос,
  // тривиальная цена; зато всегда привязаны к актуальному репо.
  private get rebase(): RebaseManager { return new RebaseManager(this.git); }
  private get bisect(): BisectManager { return new BisectManager(this.git); }
  private get hooks(): HooksManager { return new HooksManager(this.git); }
  private get worktrees(): WorktreeManager { return new WorktreeManager(this.git); }
  private get lfs(): LfsManager { return new LfsManager(this.git); }
  private get conflicts(): ConflictManager { return new ConflictManager(this.git); }

  getRepoPath(): string { return this.state.getState().repoPath; }

  // ─── Read ───
  getGraphData(maxCount: number): Promise<CommitGraphData> { return Read.getGraphData(this.queue, this.state, maxCount); }
  getCommitDetails(hash: string): Promise<CommitDetail> { return Read.getCommitDetails(this.queue, this.git, hash); }
  getCommitTree(hash: string): Promise<string[]> { return Read.getCommitTree(this.queue, this.git, hash); }
  getFileDiff(file: string, hash: string, ignoreWhitespace?: boolean, fullContext?: boolean): Promise<FileDiff[]> { return Read.getFileDiff(this.queue, this.git, file, hash, ignoreWhitespace, fullContext); }
  getFileText(file: string, hash: string): Promise<string | null> { return Read.getFileText(this.queue, this.git, file, hash); }
  getFileBlame(file: string, hash?: string): Promise<BlameResult> { return Read.getFileBlame(this.queue, this.git, file, hash); }
  getFileHistory(file: string): Promise<FileHistoryResult> { return Read.getFileHistory(this.queue, this.git, file); }
  getSubmodules(): Promise<Submodule[]> { return Read.getSubmodules(this.queue, this.git); }
  getRepoStats(): Promise<RepoStats> { return Read.getRepoStats(this.queue, this.git); }
  getDayCommits(author: string, date: string): Promise<DayCommitEntry[]> { return Read.getDayCommits(this.queue, this.git, author, date); }
  getAuthorCodeStats(authorName: string, authorEmail: string, cacheOnly?: boolean, force?: boolean): Promise<AuthorCodeStatsResult> {
    return Read.getAuthorCodeStats(this.queue, this.git, this.state, authorName, authorEmail, cacheOnly, force);
  }

  // ─── Write ───
  checkout(branch: string, mode?: Write.CheckoutMode): Promise<OperationResult> {
    return Write.checkout(this.queue, this.git, this.safety, this.state, branch, mode);
  }
  fetch(remote?: string): Promise<OperationResult> { return Write.fetch(this.queue, this.git, this.state, remote); }
  pull(rebase?: boolean, autostash?: boolean): Promise<OperationResult> {
    return Write.pull(this.queue, this.git, this.safety, this.state, rebase, undefined, undefined, autostash);
  }
  pullFrom(remote: string, branch: string, rebase?: boolean, autostash?: boolean): Promise<OperationResult> {
    return Write.pull(this.queue, this.git, this.safety, this.state, rebase, remote, branch, autostash);
  }
  push(force?: boolean, setUpstream?: boolean, remote?: string, branch?: string): Promise<OperationResult> {
    return Write.push(this.queue, this.git, this.state, force, setUpstream, remote, branch);
  }
  stash(message?: string, includeUntracked?: boolean): Promise<OperationResult> { return Write.stash(this.queue, this.git, this.state, message, includeUntracked); }
  fetchBranch(branch: string, remote?: string, setUpstream?: boolean): Promise<OperationResult> {
    return Write.fetchBranchFastForward(this.queue, this.git, this.state, branch, remote, setUpstream);
  }
  stashPop(): Promise<OperationResult> { return Write.stashPop(this.queue, this.git, this.state); }
  createBranch(name: string, from: string): Promise<OperationResult> { return Write.createBranch(this.queue, this.git, this.state, name, from); }
  trackRemoteBranch(remote: string, remoteBranch: string, localName: string): Promise<OperationResult> {
    return Write.trackRemoteBranch(this.queue, this.git, this.safety, this.state, remote, remoteBranch, localName);
  }
  renameBranch(oldName: string, newName: string): Promise<OperationResult> { return Write.renameBranch(this.queue, this.git, this.state, oldName, newName); }
  deleteBranch(branch: string, force?: boolean): Promise<OperationResult> { return Write.deleteBranch(this.queue, this.git, this.state, branch, force); }
  createTag(name: string, ref: string, message?: string): Promise<OperationResult> { return Write.createTag(this.queue, this.git, this.state, name, ref, message); }
  deleteTag(name: string, remote?: boolean): Promise<OperationResult> { return Write.deleteTag(this.queue, this.git, this.state, name, remote); }
  cherryPick(hash: string, mainline?: number): Promise<OperationResult> { return Write.cherryPick(this.queue, this.git, this.safety, this.state, hash, mainline); }
  cherryPickMany(hashes: string[]): Promise<OperationResult> { return Write.cherryPickMany(this.queue, this.git, this.safety, this.state, hashes); }
  cherryPickContinue(): Promise<OperationResult> { return Write.cherryPickContinue(this.queue, this.git, this.state); }
  cherryPickSkip(): Promise<OperationResult> { return Write.cherryPickSkip(this.queue, this.git, this.state); }
  revert(hash: string, mainline?: number): Promise<OperationResult> { return Write.revert(this.queue, this.git, this.safety, this.state, hash, mainline); }
  resetTo(hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<OperationResult> { return Write.resetTo(this.queue, this.git, this.safety, this.state, hash, mode); }
  async stashShow(index: string): Promise<FileDiff[]> {
    return this.queue.enqueueRead('stashShow', async () => {
      const r = await this.git.exec(['stash', 'show', '-p', index]);
      if (!r.stdout.trim()) return [];
      const { parseDiff } = await import('../git/DiffParser');
      return parseDiff(r.stdout);
    });
  }
  stashApply(index: string): Promise<OperationResult> { return Write.stashApply(this.queue, this.git, this.state, index); }
  stashDrop(index: string): Promise<OperationResult> { return Write.stashDrop(this.queue, this.git, this.state, index); }
  commit(message: string, amend?: boolean): Promise<OperationResult> { return Write.commit(this.queue, this.git, this.state, message, amend); }
  stageFile(file: string): Promise<OperationResult> { return Write.stageFile(this.queue, this.git, this.state, file); }
  stageAll(files: string[]): Promise<OperationResult> { return Write.stageAll(this.queue, this.git, this.state, files); }
  unstageFile(file: string): Promise<OperationResult> { return Write.unstageFile(this.queue, this.git, this.state, file); }
  unstageAll(files: string[]): Promise<OperationResult> { return Write.unstageAll(this.queue, this.git, this.state, files); }
  discardFileChanges(file: string): Promise<OperationResult> { return Write.discardFileChanges(this.queue, this.git, this.state, file); }
  discardFiles(files: string[]): Promise<OperationResult> { return Write.discardFiles(this.queue, this.git, this.state, files); }
  async deleteUntrackedFile(file: string): Promise<void> {
    await this.queue.enqueueWrite('deleteUntrackedFile', async () => {
      const { rm, stat } = await import('fs/promises');
      const { safePath } = await import('../utils/pathSecurity');
      const repoPath = this.state.getState().repoPath;
      const fullPath = safePath(repoPath, file);
      const fileStat = await stat(fullPath);
      await rm(fullPath, { recursive: fileStat.isDirectory(), force: false });
      await this.state.refreshStatusAndNotify();
    });
  }
  async deleteUntrackedFiles(files: string[]): Promise<void> {
    if (files.length === 0) return;
    await this.queue.enqueueWrite('deleteUntrackedFiles', async () => {
      const { rm, stat } = await import('fs/promises');
      const { safePath } = await import('../utils/pathSecurity');
      const repoPath = this.state.getState().repoPath;
      // Сначала валидируем все пути через safePath, только потом удаляем — иначе
      // можем удалить часть и потом упасть на запретном пути с грязным состоянием.
      const targets: { fullPath: string; isDir: boolean }[] = [];
      for (const f of files) {
        const fullPath = safePath(repoPath, f);
        const fileStat = await stat(fullPath);
        targets.push({ fullPath, isDir: fileStat.isDirectory() });
      }
      for (const t of targets) {
        await rm(t.fullPath, { recursive: t.isDir, force: false });
      }
      await this.state.refreshStatusAndNotify();
    });
  }

  async saveAsPatch(hash: string): Promise<OperationResult> {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return { success: false, error: 'No window available', rollbackAvailable: false };
    const shortHash = hash.substring(0, 7);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${shortHash}.patch`,
      filters: [{ name: 'Patch files', extensions: ['patch', 'diff'] }],
    });
    if (result.canceled || !result.filePath) return { success: true, rollbackAvailable: false };
    const r = await this.git.exec(['format-patch', '-1', hash, '--stdout']);
    if (r.exitCode !== 0) {
      return { success: false, error: `format-patch failed: ${r.stderr}`, rollbackAvailable: false };
    }
    const { writeFile } = await import('fs/promises');
    await writeFile(result.filePath, r.stdout, 'utf-8');
    return { success: true, rollbackAvailable: false };
  }

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
  discardHunk(file: string, hunkIndex: number): Promise<OperationResult> { return Write.discardHunk(this.queue, this.git, this.state, file, hunkIndex); }

  // ─── Submodules ───
  async submoduleUpdate(path: string): Promise<OperationResult> {
    return this.queue.enqueueWrite('submoduleUpdate', async () => {
      const r = await this.git.exec(['submodule', 'update', '--init', '--', path]);
      await this.state.refreshAll();
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined, rollbackAvailable: false };
    });
  }
  async submoduleInit(path: string): Promise<OperationResult> {
    return this.queue.enqueueWrite('submoduleInit', async () => {
      const r = await this.git.exec(['submodule', 'init', '--', path]);
      await this.state.refreshAll();
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined, rollbackAvailable: false };
    });
  }

  // ─── Rebase ───
  async rebaseTo(onto: string): Promise<OperationResult> {
    return this.queue.enqueueWrite('rebase', async () => {
      const r = await this.git.exec(['rebase', onto]);
      await this.state.refreshAll();
      return { success: r.exitCode === 0, error: r.exitCode !== 0 ? r.stderr : undefined, rollbackAvailable: false };
    });
  }
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
      // Pre-flight перед merge: UU / MERGE_HEAD / lock.
      const { PreflightChecks } = await import('../safety/PreflightChecks');
      const pre = new PreflightChecks(this.git);
      const report = await pre.check(this.git.getCwd(), 'merge');
      if (!report.ok) {
        await this.state.refreshAll();
        return {
          success: false,
          rollbackAvailable: false,
          errorClass: 'preflight_blocked',
          error: report.issues.map(i => i.description).join('; '),
          preflightIssues: report.issues,
        };
      }

      const result = await this.safety.wrapDestructive(
        'merge', { source },
        async () => this.conflicts.merge(source, options),
        { allowedErrorClasses: ['conflict'] },
      );

      // wrapDestructive возвращает success:true даже при merge с конфликтами —
      // нормализуем, чтобы журнал/тосты не показывали «успех».
      if (result.success && result.data && !result.data.success && result.data.conflicts.length > 0) {
        await this.state.refreshAll();
        return {
          success: false,
          rollbackAvailable: result.rollbackAvailable,
          errorClass: 'conflict',
          error: `Merge produced ${result.data.conflicts.length} conflict(s)`,
          data: result.data,
          journalEntryId: result.journalEntryId,
          savedState: result.savedState,
        };
      }

      if (result.success) {
        await this.state.refreshAll();
      } else {
        await this.state.refreshStatusAndNotify();
      }
      return result;
    });
  }

  async resolveWithOurs(file: string): Promise<void> {
    const repoPath = this.state.getState().repoPath;
    const services = this.servicesFor(repoPath);
    await services.queue.enqueueWrite('resolveOurs', async () => {
      await new ConflictManager(services.git).resolveWithOurs(file);
      await this.state.refreshStatusAndNotify(repoPath);
    });
  }

  async resolveWithTheirs(file: string): Promise<void> {
    const repoPath = this.state.getState().repoPath;
    const services = this.servicesFor(repoPath);
    await services.queue.enqueueWrite('resolveTheirs', async () => {
      await new ConflictManager(services.git).resolveWithTheirs(file);
      await this.state.refreshStatusAndNotify(repoPath);
    });
  }

  async stageResolvedConflict(file: string): Promise<void> {
    const repoPath = this.state.getState().repoPath;
    const services = this.servicesFor(repoPath);
    await services.queue.enqueueWrite('stageResolvedConflict', async () => {
      await new ConflictManager(services.git).stageResolved(file);
      await this.state.refreshStatusAndNotify(repoPath);
    });
  }

  async completeMerge(message?: string): Promise<OperationResult> {
    const repoPath = this.state.getState().repoPath;
    const services = this.servicesFor(repoPath);
    return services.queue.enqueueWrite('completeMerge', async () => {
      const blocked = await Write.runPreflight(services.git, 'completeMerge');
      if (blocked) return blocked;
      const r = await new ConflictManager(services.git).completeMerge(message);
      if (r.success) await this.state.refreshAll(repoPath);
      else await this.state.refreshStatusAndNotify(repoPath);
      return r;
    });
  }

  async abortMerge(): Promise<void> {
    const repoPath = this.state.getState().repoPath;
    const services = this.servicesFor(repoPath);
    await services.queue.enqueueWrite('abortMerge', async () => {
      await new ConflictManager(services.git).abortMerge();
      await this.state.refreshAll(repoPath);
    });
  }

  getMergeState(): Promise<MergeState> {
    return this.queue.enqueueRead('getMergeState', () => this.conflicts.getMergeState());
  }

  getMergeStateForRepo(repoPath: string): Promise<MergeState> {
    const services = this.servicesFor(repoPath);
    return services.queue.enqueueRead('getMergeState', () => new ConflictManager(services.git).getMergeState());
  }

  getConflictContent(file: string): Promise<ConflictContent> {
    return this.queue.enqueueRead('getConflictContent', async () => {
      const repoPath = this.state.getState().repoPath;
      return readConflictFile(repoPath, file);
    });
  }

  async resolveConflictRaw(file: string, rawContent: string): Promise<void> {
    await this.queue.enqueueWrite('resolveConflict', async () => {
      const repoPath = this.state.getState().repoPath;
      writeResolvedFile(repoPath, file, rawContent);
      await this.git.exec(['add', '--', file]);
      await this.state.refreshStatusAndNotify();
    });
  }

  async predictConflicts(source: string, target: string): Promise<string[]> {
    return this.conflicts.predictConflicts(source, target);
  }

  // ─── Git LFS ───
  async getLfsStatus(): Promise<LfsStatus> {
    return this.queue.enqueueRead('getLfsStatus', () => this.lfs.getStatus());
  }

  async lfsTrack(pattern: string): Promise<void> {
    await this.queue.enqueueWrite('lfsTrack', () => this.lfs.track(pattern));
  }

  async lfsUntrack(pattern: string): Promise<void> {
    await this.queue.enqueueWrite('lfsUntrack', () => this.lfs.untrack(pattern));
  }

  // ─── Worktrees ───
  async getWorktrees(): Promise<WorktreeInfo[]> {
    return this.queue.enqueueRead('getWorktrees', () => this.worktrees.list());
  }

  async addWorktree(path: string, branch: string, createBranch: boolean): Promise<string> {
    return this.queue.enqueueWrite('addWorktree', async () => {
      const output = await this.worktrees.add(path, branch, createBranch);
      await this.state.refreshAll();
      return output;
    });
  }

  async removeWorktree(path: string, force: boolean): Promise<void> {
    await this.queue.enqueueWrite('removeWorktree', async () => {
      await this.worktrees.remove(path, force);
      await this.state.refreshAll();
    });
  }

  // ─── Git Hooks ───
  async getHooks(): Promise<HookInfo[]> {
    return this.queue.enqueueRead('getHooks', () => this.hooks.listHooks());
  }

  async toggleHook(name: string, enable: boolean): Promise<void> {
    await this.queue.enqueueWrite('toggleHook', () => this.hooks.toggleHook(name, enable));
  }

  // ─── Bisect ───
  async bisectStart(bad: string, good: string): Promise<string> {
    return this.queue.enqueueWrite('bisectStart', async () => {
      const output = await this.bisect.start(bad, good);
      await this.state.refreshAll();
      return output;
    });
  }

  async bisectGood(): Promise<string> {
    return this.queue.enqueueWrite('bisectGood', async () => {
      const output = await this.bisect.markGood();
      await this.state.refreshAll();
      return output;
    });
  }

  async bisectBad(): Promise<string> {
    return this.queue.enqueueWrite('bisectBad', async () => {
      const output = await this.bisect.markBad();
      await this.state.refreshAll();
      return output;
    });
  }

  async bisectSkip(): Promise<string> {
    return this.queue.enqueueWrite('bisectSkip', async () => {
      const output = await this.bisect.skip();
      await this.state.refreshAll();
      return output;
    });
  }

  async bisectReset(): Promise<void> {
    await this.queue.enqueueWrite('bisectReset', async () => {
      await this.bisect.reset();
      await this.state.refreshAll();
    });
  }

  async getBisectStatus(): Promise<BisectStatus> {
    return this.queue.enqueueRead('getBisectStatus', () => this.bisect.getStatus());
  }

  // ─── Compare two commits ───
  async getCommitDiff(fromHash: string, toHash: string): Promise<FileChange[]> {
    return this.queue.enqueueRead('getCommitDiff', async () => {
      // toHash === 'WORKING' — сравнение коммита с рабочей копией: `git diff <from>`
      // (без второй ревизии) диффит коммит против рабочего дерева.
      const range = toHash === 'WORKING' ? [fromHash] : [`${fromHash}..${toHash}`];
      const r = await this.git.exec(['diff', '--name-status', ...range]);
      const { parseFileChanges } = await import('../git/GitParser');
      return parseFileChanges(r.stdout);
    });
  }

  /**
   * «Сравнить ветку с текущей»: что принесёт `branch` при слиянии в `base`.
   * Диффим от merge-base, а не вершину к вершине — иначе всё, что появилось
   * в `base` после ответвления, выглядит как «удалено» в `branch`.
   */
  async compareBranches(base: string, branch: string): Promise<{
    fromHash: string; toHash: string; files: FileChange[]; ahead: number; behind: number;
  } | null> {
    return this.queue.enqueueRead('compareBranches', async () => {
      const toR = await this.git.exec(['rev-parse', '--verify', '-q', `${branch}^{commit}`]);
      const baseR = await this.git.exec(['rev-parse', '--verify', '-q', `${base}^{commit}`]);
      if (toR.exitCode !== 0 || baseR.exitCode !== 0) return null;
      const toHash = toR.stdout.trim();
      const baseHash = baseR.stdout.trim();
      // Несвязанные истории — merge-base нет, сравниваем вершины.
      const mbR = await this.git.exec(['merge-base', baseHash, toHash]);
      const fromHash = mbR.exitCode === 0 && mbR.stdout.trim() ? mbR.stdout.trim() : baseHash;
      const diffR = await this.git.exec(['diff', '--name-status', `${fromHash}..${toHash}`]);
      const countR = await this.git.exec(['rev-list', '--left-right', '--count', `${baseHash}...${toHash}`]);
      const [behind = 0, ahead = 0] = countR.stdout.trim().split(/\s+/).map(n => Number(n) || 0);
      const { parseFileChanges } = await import('../git/GitParser');
      return { fromHash, toHash, files: parseFileChanges(diffR.stdout), ahead, behind };
    });
  }

  // ─── Reflog ───
  async getReflog(maxCount = 100): Promise<ReflogEntry[]> {
    return this.queue.enqueueRead('getReflog', async () => {
      const { reflogArgs, parseReflog } = await import('../git/ReflogParser');
      const r = await this.git.exec(reflogArgs(maxCount));
      return parseReflog(r.stdout);
    });
  }

  /** Restores HEAD to a reflog entry via `git reset --hard`. */
  async restoreReflog(hash: string): Promise<OperationResult> {
    return this.queue.enqueueWrite('restoreReflog', async () => {
      const result = await this.safety.wrapDestructive(
        'restoreReflog', { hash },
        async () => {
          const r = await this.git.exec(['reset', '--hard', hash]);
          if (r.exitCode !== 0) {
            const { GitError } = await import('../git/GitExecutor');
            throw new GitError(`Restore failed: ${r.stderr}`, 'reset', r.exitCode, r.stderr);
          }
        },
        { allowedErrorClasses: [] },
      );
      await this.state.refreshAll();
      return result;
    });
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

  /**
   * Native picker папки без побочных эффектов. В отличие от
   * `openRepoDialog`, НЕ открывает выбранный путь как репо — нужен для
   * clone/init dialogs (Обзор...) и любых других мест, где надо
   * получить путь обратно в renderer.
   */
  async pickDirectory(opts?: { title?: string; defaultPath?: string }): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: opts?.title,
      defaultPath: opts?.defaultPath,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }

  getDiffPayload(file: string, hash: string) { return { file, hash, repoPath: this.state.getState().repoPath }; }
  getFilePayload(file: string) { return { file, repoPath: this.state.getState().repoPath }; }

  async openRepo(repoPath: string): Promise<void> {
    // not-a-repo: единственный жёсткий отказ. Локализованный код, renderer
    // переведёт через `repoErrors.notARepo`.
    const isGitRepo = await this.validateGitRepo(repoPath);
    if (!isGitRepo) {
      throw new AppError(
        'repoErrors.notARepo',
        { path: repoPath },
        `"${repoPath}" is not a git repository`,
      );
    }
    // dangerous-пути (домашка, корень диска, системные каталоги) больше НЕ
    // блокируем — пользователь может намеренно открыть огромную папку.
    // Защита от «всё умирает» теперь чисто архитектурная:
    //   - FileWatcher не запускает worktreeWatcher (см. repoPathGuard);
    //   - StateManager.switchRepo НЕ ждёт refreshAll, она в фоне;
    //   - git status адаптивно: =all для нормальных репо (полный список
    //     untracked-файлов), =normal только для опасных корней.
    // Так Fork-style «папка открылась пустой, файлы появятся со временем»
    // достигается без хардкод-блокировок.
    this.state.setRepoPath(repoPath);
    await this.state.switchRepo(repoPath);
  }

  async closeRepo(index: number): Promise<void> {
    const s = this.state.getState();
    if (index < 0 || index >= s.openRepos.length) return;
    const closedPath = s.openRepos[index].path;
    const repos = [...s.openRepos];
    repos.splice(index, 1);
    this.state.setOpenRepos(repos);

    // Нотификация ДО возможного switchRepo, чтобы FileWatcher закрыл
    // watcher'ы закрытого репо, а MessageBridge и прочие слушатели
    // освободили ссылки на его данные. Без этого — утечка FD / памяти
    // на сессию, пропорциональная количеству закрытых табов.
    this.state.notifyRepoClose(closedPath);

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
