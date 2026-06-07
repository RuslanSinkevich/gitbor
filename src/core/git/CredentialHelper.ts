import type { GitExecutor } from './GitExecutor';

export interface CredentialTarget {
  protocol: 'https' | 'http';
  host: string;
  path: string;
  displayUrl: string;
  suggestedUsername: string;
}

/** Разбор URL remote для git credential protocol (HTTPS). */
export function parseHttpsRemoteUrl(raw: string): CredentialTarget | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    if (trimmed.startsWith('git@')) {
      const m = trimmed.match(/^git@([^:]+):(.+)$/);
      if (!m) return null;
      url = new URL(`https://${m[1]}/${m[2]}`);
    } else {
      url = new URL(trimmed);
    }
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const protocol = url.protocol === 'http:' ? 'http' : 'https';
  const path = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  const displayUrl = url.origin + (path ? `/${path}` : '');

  return {
    protocol,
    host: url.hostname,
    path,
    displayUrl,
    suggestedUsername: url.username ? decodeURIComponent(url.username) : '',
  };
}

function credentialPayload(target: CredentialTarget, extra?: { username?: string; password?: string }): string {
  const lines = [
    `protocol=${target.protocol}`,
    `host=${target.host}`,
  ];
  if (target.path) lines.push(`path=${target.path}`);
  if (extra?.username) lines.push(`username=${extra.username}`);
  if (extra?.password) lines.push(`password=${extra.password}`);
  return `${lines.join('\n')}\n`;
}

export class CredentialHelper {
  constructor(private readonly git: GitExecutor) {}

  async getPushRemoteUrl(): Promise<string | null> {
    for (const args of [['remote', 'get-url', '--push', 'origin'], ['remote', 'get-url', 'origin']] as const) {
      const r = await this.git.exec([...args]);
      if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim();
    }
    return null;
  }

  async getCredentialTarget(): Promise<CredentialTarget | null> {
    const raw = await this.getPushRemoteUrl();
    if (!raw || raw.startsWith('git@')) return null;
    return parseHttpsRemoteUrl(raw);
  }

  /**
   * Настроен ли вообще `credential.helper`. Без него `git credential
   * approve/reject` — no-op: пароль не сохранится в хранилище ОС, и при
   * следующем push git снова спросит. UI должен честно предупредить.
   */
  async hasCredentialHelper(): Promise<boolean> {
    const r = await this.git.exec(['config', '--get-all', 'credential.helper']);
    if (r.exitCode !== 0) return false;
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .some((l) => l.length > 0);
  }

  async clearCredentials(target: CredentialTarget): Promise<void> {
    await this.runCredential('reject', target);
    if (target.path) {
      await this.runCredential('reject', { ...target, path: '' });
    }
  }

  async storeCredentials(target: CredentialTarget, username: string, password: string): Promise<void> {
    await this.clearCredentials(target);
    await this.runCredential('approve', target, { username, password });
  }

  private async runCredential(
    subcommand: 'reject' | 'approve',
    target: CredentialTarget,
    auth?: { username: string; password: string },
  ): Promise<void> {
    const stdin = credentialPayload(target, auth);
    const r = await this.git.exec(['credential', subcommand], { stdin });
    if (r.exitCode !== 0) {
      throw new Error(r.stderr.trim() || `git credential ${subcommand} failed`);
    }
  }
}
