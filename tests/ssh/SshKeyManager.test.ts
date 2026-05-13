import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';

/**
 * Unit-тесты SshKeyManager. Стратегия:
 * - реальная файловая система во временной папке (mock os.homedir → tmpRoot)
 * - мокаем child_process.{execFile, spawn} чтобы:
 *   1) не вызывать настоящий ssh-keygen,
 *   2) подсмотреть argv (проверка, что passphrase НЕ попадает в argv генерации),
 *   3) самим создавать "сгенерированные" файлы ключей для сценария happy-path.
 */

let tmpHome: string;

const execFileCalls: Array<{ cmd: string; args: string[] }> = [];
const spawnCalls: Array<{ cmd: string; args: string[] }> = [];

// Поведение execFile — даём кастомизировать через переменную.
let execFileImpl: ((cmd: string, args: string[], cb: ExecFileCb) => void) | null = null;
type ExecFileCb = (err: Error | null, stdout: string, stderr: string) => void;

// Поведение spawn — даём кастомизировать.
let spawnImpl: ((cmd: string, args: string[]) => SpawnedProc) | null = null;
interface SpawnedProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (data: string) => void; end: () => void };
}

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return {
    ...actual,
    homedir: () => tmpHome,
  };
});

vi.mock('child_process', () => ({
  execFile: (cmd: string, args: string[], _opts: unknown, cb: ExecFileCb) => {
    execFileCalls.push({ cmd, args });
    if (execFileImpl) {
      execFileImpl(cmd, args, cb);
    } else {
      cb(null, '', '');
    }
  },
  spawn: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    return spawnImpl ? spawnImpl(cmd, args) : defaultSpawn();
  },
}));

function defaultSpawn(): SpawnedProc {
  const proc = new EventEmitter() as SpawnedProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  setImmediate(() => proc.emit('close', 0));
  return proc;
}

async function importFresh() {
  vi.resetModules();
  return await import('../../src/core/ssh/SshKeyManager');
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gitbor-ssh-test-'));
  execFileCalls.length = 0;
  spawnCalls.length = 0;
  execFileImpl = null;
  spawnImpl = null;
});

afterEach(() => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('SshKeyManager', () => {
  describe('listSshKeys', () => {
    it('returns [] when ~/.ssh does not exist', async () => {
      const { listSshKeys } = await importFresh();
      // tmpHome не имеет .ssh — listSshKeys должен вернуть []
      const keys = await listSshKeys();
      expect(keys).toEqual([]);
    });

    it('returns [] when ~/.ssh is empty', async () => {
      fs.mkdirSync(path.join(tmpHome, '.ssh'));
      const { listSshKeys } = await importFresh();
      const keys = await listSshKeys();
      expect(keys).toEqual([]);
    });

    it('skips orphaned .pub files without matching private key', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      fs.writeFileSync(path.join(sshDir, 'orphan.pub'), 'ssh-ed25519 AAAA orphan@host');
      const { listSshKeys } = await importFresh();
      const keys = await listSshKeys();
      expect(keys).toEqual([]);
    });

    it('parses key type and comment from .pub', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      fs.writeFileSync(path.join(sshDir, 'id_ed25519.pub'), 'ssh-ed25519 AAAABASE64KEY user@host');
      fs.writeFileSync(path.join(sshDir, 'id_ed25519'), 'PRIVATE');
      execFileImpl = (_cmd, _args, cb) => cb(null, '256 SHA256:fingerprint user@host (ED25519)\n', '');
      const { listSshKeys } = await importFresh();
      const keys = await listSshKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe('id_ed25519');
      expect(keys[0].type).toBe('ssh-ed25519');
      expect(keys[0].comment).toBe('user@host');
      expect(keys[0].bits).toBe('256');
      expect(keys[0].fingerprint).toBe('SHA256:fingerprint');
    });

    it('tolerates ssh-keygen not available (fingerprint/bits empty)', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      fs.writeFileSync(path.join(sshDir, 'id_rsa.pub'), 'ssh-rsa AAAA rsa@host');
      fs.writeFileSync(path.join(sshDir, 'id_rsa'), 'PRIVATE');
      execFileImpl = (_cmd, _args, cb) => cb(new Error('ENOENT ssh-keygen'), '', '');
      const { listSshKeys } = await importFresh();
      const keys = await listSshKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].fingerprint).toBe('');
      expect(keys[0].bits).toBe('');
    });

    it('parses empty comment when .pub has only 2 fields', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      fs.writeFileSync(path.join(sshDir, 'nocomment.pub'), 'ssh-ed25519 AAAA');
      fs.writeFileSync(path.join(sshDir, 'nocomment'), 'PRIVATE');
      execFileImpl = (_cmd, _args, cb) => cb(null, '', '');
      const { listSshKeys } = await importFresh();
      const keys = await listSshKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].comment).toBe('');
    });

    it('returns multiple keys when multiple pairs exist', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      fs.writeFileSync(path.join(sshDir, 'k1.pub'), 'ssh-ed25519 AAAA1 k1@h');
      fs.writeFileSync(path.join(sshDir, 'k1'), 'P1');
      fs.writeFileSync(path.join(sshDir, 'k2.pub'), 'ssh-rsa AAAA2 k2@h');
      fs.writeFileSync(path.join(sshDir, 'k2'), 'P2');
      execFileImpl = (_cmd, _args, cb) => cb(null, '256 SHA256:x k@h (ED25519)\n', '');
      const { listSshKeys } = await importFresh();
      const keys = await listSshKeys();
      expect(keys).toHaveLength(2);
      const names = keys.map(k => k.name).sort();
      expect(names).toEqual(['k1', 'k2']);
    });
  });

  describe('generateSshKey', () => {
    it('throws on invalid filename', async () => {
      const { generateSshKey } = await importFresh();
      await expect(generateSshKey({
        name: '../escape',
        type: 'ed25519',
        passphrase: '',
        comment: '',
      })).rejects.toThrow(/Invalid key name/);
    });

    it('throws on filename with spaces', async () => {
      const { generateSshKey } = await importFresh();
      await expect(generateSshKey({
        name: 'has space',
        type: 'ed25519',
        passphrase: '',
        comment: '',
      })).rejects.toThrow(/Invalid key name/);
    });

    it('throws when key already exists', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      fs.writeFileSync(path.join(sshDir, 'existing'), 'P');
      const { generateSshKey } = await importFresh();
      await expect(generateSshKey({
        name: 'existing',
        type: 'ed25519',
        passphrase: '',
        comment: '',
      })).rejects.toThrow(/already exists/);
    });

    it('creates ~/.ssh dir if missing', async () => {
      // .ssh не существует. spawn должен "сгенерировать" ключ.
      spawnImpl = (_cmd, args) => {
        const fIdx = args.indexOf('-f');
        const keyPath = args[fIdx + 1];
        fs.writeFileSync(keyPath, 'PRIVATE');
        fs.writeFileSync(keyPath + '.pub', 'ssh-ed25519 AAAA generated@h');
        return defaultSpawn();
      };
      execFileImpl = (_cmd, _args, cb) => cb(null, '256 SHA256:fp user@h (ED25519)\n', '');
      const { generateSshKey } = await importFresh();
      await generateSshKey({ name: 'mykey', type: 'ed25519', passphrase: '', comment: '' });
      expect(fs.existsSync(path.join(tmpHome, '.ssh'))).toBe(true);
    });

    it('passes ssh-keygen argv WITHOUT passphrase on generation step', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      spawnImpl = (_cmd, args) => {
        const fIdx = args.indexOf('-f');
        const keyPath = args[fIdx + 1];
        fs.writeFileSync(keyPath, 'PRIVATE');
        fs.writeFileSync(keyPath + '.pub', 'ssh-ed25519 AAAA gen@h');
        return defaultSpawn();
      };
      execFileImpl = (_cmd, _args, cb) => cb(null, '256 SHA256:fp u@h (ED25519)\n', '');
      const { generateSshKey } = await importFresh();
      await generateSshKey({
        name: 'k1',
        type: 'ed25519',
        passphrase: 'super-secret-pass',
        comment: 'me@host',
      });
      // Главный инвариант безопасности: на этапе spawn — passphrase НЕ в argv.
      const genCall = spawnCalls[0];
      expect(genCall.args).not.toContain('super-secret-pass');
      // Должно быть -N "" (пустая passphrase) для генерации
      const nIdx = genCall.args.indexOf('-N');
      expect(nIdx).toBeGreaterThan(-1);
      expect(genCall.args[nIdx + 1]).toBe('');
    });

    it('passes -t ed25519 for ed25519 keys, NO -b bits', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      spawnImpl = (_cmd, args) => {
        const fIdx = args.indexOf('-f');
        const keyPath = args[fIdx + 1];
        fs.writeFileSync(keyPath, 'P');
        fs.writeFileSync(keyPath + '.pub', 'ssh-ed25519 AAAA c');
        return defaultSpawn();
      };
      execFileImpl = (_cmd, _args, cb) => cb(null, '256 SHA256:fp c (ED25519)\n', '');
      const { generateSshKey } = await importFresh();
      await generateSshKey({ name: 'k2', type: 'ed25519', bits: 4096, passphrase: '', comment: '' });
      const args = spawnCalls[0].args;
      expect(args).toContain('-t');
      expect(args[args.indexOf('-t') + 1]).toBe('ed25519');
      expect(args).not.toContain('-b');
    });

    it('passes -b bits for RSA keys', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      spawnImpl = (_cmd, args) => {
        const fIdx = args.indexOf('-f');
        const keyPath = args[fIdx + 1];
        fs.writeFileSync(keyPath, 'P');
        fs.writeFileSync(keyPath + '.pub', 'ssh-rsa AAAA c');
        return defaultSpawn();
      };
      execFileImpl = (_cmd, _args, cb) => cb(null, '4096 SHA256:fp c (RSA)\n', '');
      const { generateSshKey } = await importFresh();
      await generateSshKey({ name: 'rsakey', type: 'rsa', bits: 4096, passphrase: '', comment: '' });
      const args = spawnCalls[0].args;
      expect(args).toContain('-b');
      expect(args[args.indexOf('-b') + 1]).toBe('4096');
    });

    it('uses comment as -C, falling back to name when empty', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      spawnImpl = (_cmd, args) => {
        const fIdx = args.indexOf('-f');
        const kp = args[fIdx + 1];
        fs.writeFileSync(kp, 'P');
        fs.writeFileSync(kp + '.pub', 'ssh-ed25519 AAAA c');
        return defaultSpawn();
      };
      execFileImpl = (_cmd, _args, cb) => cb(null, '256 SHA256:fp c (ED25519)\n', '');
      const { generateSshKey } = await importFresh();
      await generateSshKey({ name: 'nm', type: 'ed25519', passphrase: '', comment: '' });
      const args = spawnCalls[0].args;
      const cIdx = args.indexOf('-C');
      expect(args[cIdx + 1]).toBe('nm');
    });
  });

  describe('readPublicKey', () => {
    it('throws on invalid filename', async () => {
      const { readPublicKey } = await importFresh();
      expect(() => readPublicKey('../bad')).toThrow(/Invalid key name/);
    });

    it('throws when .pub file missing', async () => {
      fs.mkdirSync(path.join(tmpHome, '.ssh'));
      const { readPublicKey } = await importFresh();
      expect(() => readPublicKey('absent')).toThrow(/not found/);
    });

    it('reads and trims public key content', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      fs.writeFileSync(path.join(sshDir, 'k.pub'), '  ssh-ed25519 AAAA me@h  \n\n');
      const { readPublicKey } = await importFresh();
      expect(readPublicKey('k')).toBe('ssh-ed25519 AAAA me@h');
    });
  });

  describe('deleteSshKey', () => {
    it('throws on invalid filename', async () => {
      const { deleteSshKey } = await importFresh();
      expect(() => deleteSshKey('../etc/passwd')).toThrow(/Invalid key name/);
    });

    it('removes both private and public keys', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      fs.writeFileSync(path.join(sshDir, 'kill'), 'P');
      fs.writeFileSync(path.join(sshDir, 'kill.pub'), 'ssh-ed25519 AAAA');
      const { deleteSshKey } = await importFresh();
      deleteSshKey('kill');
      expect(fs.existsSync(path.join(sshDir, 'kill'))).toBe(false);
      expect(fs.existsSync(path.join(sshDir, 'kill.pub'))).toBe(false);
    });

    it('does not throw when files do not exist', async () => {
      fs.mkdirSync(path.join(tmpHome, '.ssh'));
      const { deleteSshKey } = await importFresh();
      expect(() => deleteSshKey('absent')).not.toThrow();
    });

    it('removes only .pub if private is missing', async () => {
      const sshDir = path.join(tmpHome, '.ssh');
      fs.mkdirSync(sshDir);
      fs.writeFileSync(path.join(sshDir, 'half.pub'), 'ssh-ed25519 AAAA');
      const { deleteSshKey } = await importFresh();
      deleteSshKey('half');
      expect(fs.existsSync(path.join(sshDir, 'half.pub'))).toBe(false);
    });
  });
});
