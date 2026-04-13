import { GitExecutor } from './GitExecutor';

export interface RepoSettings {
  localName: string;
  localEmail: string;
  globalName: string;
  globalEmail: string;
  useGlobal: boolean;
}

export class GitConfig {
  constructor(private git: GitExecutor) {}

  async getRepoSettings(): Promise<RepoSettings> {
    const [localName, localEmail, globalName, globalEmail] = await Promise.all([
      this.get('user.name', 'local'),
      this.get('user.email', 'local'),
      this.get('user.name', 'global'),
      this.get('user.email', 'global'),
    ]);

    return {
      localName,
      localEmail,
      globalName,
      globalEmail,
      useGlobal: !localName && !localEmail,
    };
  }

  async setRepoSettings(opts: {
    useGlobal: boolean;
    name: string;
    email: string;
  }): Promise<void> {
    if (opts.useGlobal) {
      await this.unset('user.name', 'local');
      await this.unset('user.email', 'local');
    } else {
      await this.set('user.name', opts.name, 'local');
      await this.set('user.email', opts.email, 'local');
    }
  }

  private async get(key: string, scope: 'local' | 'global'): Promise<string> {
    try {
      const r = await this.git.exec(['config', `--${scope}`, key]);
      return r.exitCode === 0 ? r.stdout.trim() : '';
    } catch {
      return '';
    }
  }

  private async set(key: string, value: string, scope: 'local' | 'global'): Promise<void> {
    await this.git.exec(['config', `--${scope}`, key, value]);
  }

  private async unset(key: string, scope: 'local' | 'global'): Promise<void> {
    try {
      await this.git.exec(['config', `--${scope}`, '--unset', key]);
    } catch {
      // already unset
    }
  }
}
