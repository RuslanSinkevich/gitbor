import { GitExecutor, GitError } from './GitExecutor';

/** Git LFS tracked file info. */
export interface LfsFile {
  name: string;
  size: string;
  oid: string;
}

/** Git LFS tracking pattern. */
export interface LfsPattern {
  pattern: string;
}

/** Git LFS overall status. */
export interface LfsStatus {
  installed: boolean;
  patterns: LfsPattern[];
  files: LfsFile[];
}

/** Manages Git LFS operations — status, track, untrack. */
export class LfsManager {
  constructor(private readonly git: GitExecutor) {}

  /** Checks if LFS is installed and returns full status. */
  async getStatus(): Promise<LfsStatus> {
    const installed = await this.isInstalled();
    if (!installed) return { installed: false, patterns: [], files: [] };

    const [patterns, files] = await Promise.all([
      this.getTrackedPatterns(),
      this.getTrackedFiles(),
    ]);

    return { installed, patterns, files };
  }

  /** Adds a track pattern (e.g. "*.psd"). */
  async track(pattern: string): Promise<void> {
    const r = await this.git.exec(['lfs', 'track', pattern]);
    if (r.exitCode !== 0) throw new GitError(`LFS track failed: ${r.stderr}`, 'lfs', r.exitCode, r.stderr);
  }

  /** Removes a track pattern. */
  async untrack(pattern: string): Promise<void> {
    const r = await this.git.exec(['lfs', 'untrack', pattern]);
    if (r.exitCode !== 0) throw new GitError(`LFS untrack failed: ${r.stderr}`, 'lfs', r.exitCode, r.stderr);
  }

  /** Checks if git-lfs is available. */
  private async isInstalled(): Promise<boolean> {
    try {
      const r = await this.git.exec(['lfs', 'version']);
      return r.exitCode === 0;
    } catch {
      return false;
    }
  }

  /** Returns tracked patterns from .gitattributes. */
  private async getTrackedPatterns(): Promise<LfsPattern[]> {
    try {
      const r = await this.git.exec(['lfs', 'track']);
      const patterns: LfsPattern[] = [];
      for (const line of r.stdout.split('\n')) {
        const m = line.match(/^\s+(.+?)\s+\(.+\)$/);
        if (m) patterns.push({ pattern: m[1] });
      }
      return patterns;
    } catch {
      return [];
    }
  }

  /** Returns tracked files with size and OID. */
  private async getTrackedFiles(): Promise<LfsFile[]> {
    try {
      const r = await this.git.exec(['lfs', 'ls-files', '--long']);
      const files: LfsFile[] = [];
      for (const line of r.stdout.trim().split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 3) {
          const oid = parts[0];
          const marker = parts[1];
          const name = parts.slice(2).join(' ');
          files.push({ name, size: marker, oid: oid.substring(0, 10) });
        }
      }
      return files;
    } catch {
      return [];
    }
  }
}
