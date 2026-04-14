import { existsSync } from 'fs';
import { join } from 'path';
import { GitExecutor } from './GitExecutor';

/** Status of an active bisect session. */
export interface BisectStatus {
  active: boolean;
  current: string;
  stepsLeft: number;
  goodCount: number;
  badCount: number;
  log: string[];
}

/**
 * Manages `git bisect` operations.
 * Stateless — reads state from the git dir on each call.
 */
export class BisectManager {
  constructor(private readonly git: GitExecutor) {}

  /** Starts a bisect session between bad and good commits. */
  async start(bad: string, good: string): Promise<string> {
    await this.git.exec(['bisect', 'start']);
    await this.git.exec(['bisect', 'bad', bad]);
    const r = await this.git.exec(['bisect', 'good', good]);
    return r.stdout + r.stderr;
  }

  /** Marks the current commit as good. */
  async markGood(): Promise<string> {
    const r = await this.git.exec(['bisect', 'good']);
    return r.stdout + r.stderr;
  }

  /** Marks the current commit as bad. */
  async markBad(): Promise<string> {
    const r = await this.git.exec(['bisect', 'bad']);
    return r.stdout + r.stderr;
  }

  /** Skips the current commit. */
  async skip(): Promise<string> {
    const r = await this.git.exec(['bisect', 'skip']);
    return r.stdout + r.stderr;
  }

  /** Aborts the bisect session, returning to the original HEAD. */
  async reset(): Promise<void> {
    await this.git.exec(['bisect', 'reset']);
  }

  /** Returns current bisect status by reading git state. */
  async getStatus(): Promise<BisectStatus> {
    const active = this.isActive();
    if (!active) {
      return { active: false, current: '', stepsLeft: 0, goodCount: 0, badCount: 0, log: [] };
    }

    const headR = await this.git.exec(['rev-parse', '--short', 'HEAD']);
    const current = headR.stdout.trim();

    const logR = await this.git.exec(['bisect', 'log']);
    const logLines = logR.stdout.trim().split('\n').filter(l => l && !l.startsWith('#'));

    const goodCount = logLines.filter(l => l.startsWith('git bisect good') || l.includes('# good:')).length;
    const badCount = logLines.filter(l => l.startsWith('git bisect bad') || l.includes('# bad:')).length;

    const visualizeR = await this.git.exec(['bisect', 'visualize', '--oneline']);
    const stepsLeft = Math.max(0, visualizeR.stdout.trim().split('\n').filter(Boolean).length);

    return { active: true, current, stepsLeft, goodCount, badCount, log: logLines };
  }

  /** Checks if a bisect session is active. */
  isActive(): boolean {
    const gitDir = join(this.git.getCwd(), '.git');
    return existsSync(join(gitDir, 'BISECT_LOG'));
  }
}
