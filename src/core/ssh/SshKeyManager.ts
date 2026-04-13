import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';

export interface SshKeyInfo {
  name: string;
  type: string;
  bits: string;
  fingerprint: string;
  publicKeyPath: string;
  privateKeyPath: string;
  comment: string;
}

function getSshDir(): string {
  return path.join(os.homedir(), '.ssh');
}

function parsePubKey(pubContent: string): { type: string; comment: string } {
  const parts = pubContent.trim().split(/\s+/);
  return {
    type: parts[0] || 'unknown',
    comment: parts.length >= 3 ? parts.slice(2).join(' ') : '',
  };
}

function sshKeygen(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('ssh-keygen', args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

export async function listSshKeys(): Promise<SshKeyInfo[]> {
  const sshDir = getSshDir();
  if (!fs.existsSync(sshDir)) return [];

  const files = fs.readdirSync(sshDir);
  const pubFiles = files.filter(f => f.endsWith('.pub'));
  const keys: SshKeyInfo[] = [];

  for (const pubFile of pubFiles) {
    const pubPath = path.join(sshDir, pubFile);
    const privPath = path.join(sshDir, pubFile.replace(/\.pub$/, ''));

    if (!fs.existsSync(privPath)) continue;

    const pubContent = fs.readFileSync(pubPath, 'utf-8');
    const { type, comment } = parsePubKey(pubContent);

    let fingerprint = '';
    let bits = '';
    try {
      const result = await sshKeygen(['-l', '-f', pubPath]);
      const match = result.stdout.match(/^(\d+)\s+(\S+)/);
      if (match) {
        bits = match[1];
        fingerprint = match[2];
      }
    } catch {
      // ssh-keygen not available or error
    }

    keys.push({
      name: pubFile.replace(/\.pub$/, ''),
      type,
      bits,
      fingerprint,
      publicKeyPath: pubPath,
      privateKeyPath: privPath,
      comment,
    });
  }

  return keys;
}

export async function generateSshKey(opts: {
  name: string;
  type: 'ed25519' | 'rsa';
  bits?: number;
  passphrase: string;
  comment: string;
}): Promise<SshKeyInfo> {
  const sshDir = getSshDir();
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  }

  const keyPath = path.join(sshDir, opts.name);

  if (fs.existsSync(keyPath) || fs.existsSync(keyPath + '.pub')) {
    throw new Error(`Key "${opts.name}" already exists`);
  }

  const args = ['-t', opts.type, '-f', keyPath, '-N', opts.passphrase, '-C', opts.comment || opts.name];
  if (opts.type === 'rsa' && opts.bits) {
    args.push('-b', String(opts.bits));
  }

  await sshKeygen(args);

  const pubContent = fs.readFileSync(keyPath + '.pub', 'utf-8');
  const { type, comment } = parsePubKey(pubContent);

  let fingerprint = '';
  let bits = '';
  try {
    const result = await sshKeygen(['-l', '-f', keyPath + '.pub']);
    const match = result.stdout.match(/^(\d+)\s+(\S+)/);
    if (match) { bits = match[1]; fingerprint = match[2]; }
  } catch { /* */ }

  return {
    name: opts.name,
    type,
    bits,
    fingerprint,
    publicKeyPath: keyPath + '.pub',
    privateKeyPath: keyPath,
    comment,
  };
}

export function readPublicKey(name: string): string {
  const pubPath = path.join(getSshDir(), name + '.pub');
  if (!fs.existsSync(pubPath)) throw new Error(`Public key not found: ${name}`);
  return fs.readFileSync(pubPath, 'utf-8').trim();
}

export function deleteSshKey(name: string): void {
  const sshDir = getSshDir();
  const privPath = path.join(sshDir, name);
  const pubPath = privPath + '.pub';

  if (fs.existsSync(privPath)) fs.unlinkSync(privPath);
  if (fs.existsSync(pubPath)) fs.unlinkSync(pubPath);
}
