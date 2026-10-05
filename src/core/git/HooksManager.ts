import { readdir, readFile, rename, chmod, stat } from 'fs/promises';
import { join } from 'path';
import { GitExecutor } from './GitExecutor';
import { isSafeFilename } from '../utils/pathSecurity';
import { resolveCommonGitDir } from './gitDir';

/** Known git hook names. */
const KNOWN_HOOKS = [
  'pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit',
  'pre-rebase', 'post-rewrite', 'post-checkout', 'post-merge',
  'pre-push', 'pre-receive', 'update', 'post-receive', 'post-update',
  'pre-auto-gc', 'fsmonitor-watchman', 'applypatch-msg', 'pre-applypatch',
  'post-applypatch',
] as const;

export interface HookInfo {
  name: string;
  enabled: boolean;
  content: string;
}

/**
 * Manages git hooks — listing, reading, and toggling.
 * Disabled hooks are renamed with a `.disabled` suffix.
 */
export class HooksManager {
  constructor(private readonly git: GitExecutor) {}

  /** Returns the hooks directory path. */
  private getHooksDir(): string {
    return join(resolveCommonGitDir(this.git.getCwd()), 'hooks');
  }

  /** Lists all hooks with their enabled status and content. */
  async listHooks(): Promise<HookInfo[]> {
    const dir = this.getHooksDir();
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }

    const hooks: HookInfo[] = [];

    for (const file of files) {
      if (file.endsWith('.sample')) continue;

      const isDisabled = file.endsWith('.disabled');
      const name = isDisabled ? file.replace(/\.disabled$/, '') : file;

      if (!(KNOWN_HOOKS as readonly string[]).includes(name) && !isDisabled) {
        const fileStat = await stat(join(dir, file)).catch(() => null);
        if (!fileStat || !fileStat.isFile()) continue;
      }

      try {
        const content = await readFile(join(dir, file), 'utf-8');
        hooks.push({ name, enabled: !isDisabled, content });
      } catch {
        hooks.push({ name, enabled: !isDisabled, content: '' });
      }
    }

    hooks.sort((a, b) => a.name.localeCompare(b.name));
    return hooks;
  }

  /** Toggles a hook by renaming it with/without `.disabled` suffix. */
  async toggleHook(name: string, enable: boolean): Promise<void> {
    if (!isSafeFilename(name)) throw new Error(`Invalid hook name: ${name}`);
    const dir = this.getHooksDir();
    const enabledPath = join(dir, name);
    const disabledPath = join(dir, `${name}.disabled`);

    if (enable) {
      await rename(disabledPath, enabledPath);
      await chmod(enabledPath, 0o755).catch(() => {});
    } else {
      await rename(enabledPath, disabledPath);
    }
  }
}
