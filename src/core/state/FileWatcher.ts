import * as path from 'path';
import chokidar from 'chokidar';
import { StateManager } from './StateManager';

const GIT_DEBOUNCE_MS = 300;
const WORKTREE_DEBOUNCE_MS = 500;

export class FileWatcher {
  private gitWatcher: chokidar.FSWatcher | null = null;
  private worktreeWatcher: chokidar.FSWatcher | null = null;
  private gitDebounce: NodeJS.Timeout | null = null;
  private worktreeDebounce: NodeJS.Timeout | null = null;

  constructor(private readonly stateManager: StateManager) {}

  watch(repoPath: string): void {
    this.unwatch();

    const gitDir = path.join(repoPath, '.git');
    this.gitWatcher = chokidar.watch(gitDir, {
      ignoreInitial: true,
      depth: 3,
      awaitWriteFinish: { stabilityThreshold: 100 },
    });

    this.gitWatcher.on('change', () => this.scheduleGitRefresh());
    this.gitWatcher.on('add', () => this.scheduleGitRefresh());
    this.gitWatcher.on('unlink', () => this.scheduleGitRefresh());

    this.worktreeWatcher = chokidar.watch(repoPath, {
      ignoreInitial: true,
      ignored: [
        /(^|[/\\])\.git([/\\]|$)/,
        /(^|[/\\])node_modules([/\\]|$)/,
        /(^|[/\\])\.DS_Store$/,
        /(^|[/\\])Thumbs\.db$/,
      ],
      depth: 5,
      awaitWriteFinish: { stabilityThreshold: 200 },
    });

    this.worktreeWatcher.on('change', () => this.scheduleStatusRefresh());
    this.worktreeWatcher.on('add', () => this.scheduleStatusRefresh());
    this.worktreeWatcher.on('unlink', () => this.scheduleStatusRefresh());
  }

  unwatch(): void {
    if (this.gitDebounce) { clearTimeout(this.gitDebounce); this.gitDebounce = null; }
    if (this.worktreeDebounce) { clearTimeout(this.worktreeDebounce); this.worktreeDebounce = null; }
    if (this.gitWatcher) { this.gitWatcher.close(); this.gitWatcher = null; }
    if (this.worktreeWatcher) { this.worktreeWatcher.close(); this.worktreeWatcher = null; }
  }

  switchRepo(repoPath: string): void {
    this.watch(repoPath);
  }

  dispose(): void {
    this.unwatch();
  }

  private scheduleGitRefresh(): void {
    if (this.gitDebounce) clearTimeout(this.gitDebounce);
    this.gitDebounce = setTimeout(() => {
      this.gitDebounce = null;
      this.stateManager.invalidateGraphCache();
      this.stateManager.refreshAll().catch((err) => {
        console.error('[SkyFork FileWatcher] refreshAll failed:', err instanceof Error ? err.message : err);
      });
    }, GIT_DEBOUNCE_MS);
  }

  private scheduleStatusRefresh(): void {
    if (this.worktreeDebounce) clearTimeout(this.worktreeDebounce);
    this.worktreeDebounce = setTimeout(() => {
      this.worktreeDebounce = null;
      this.stateManager.refreshStatusAndNotify().catch((err) => {
        console.error('[SkyFork FileWatcher] refreshStatus failed:', err instanceof Error ? err.message : err);
      });
    }, WORKTREE_DEBOUNCE_MS);
  }
}
