import { describe, it, expect, afterEach } from 'vitest';
import { safePath, isSafeFilename } from '@core/utils/pathSecurity';
import { resolve } from 'path';

const isWin = process.platform === 'win32';

let originalPlatform: PropertyDescriptor | undefined;
function setPlatform(p: NodeJS.Platform): void {
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
function restorePlatform(): void {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  originalPlatform = undefined;
}

describe('safePath', () => {
  const base = resolve('/tmp/test-repo');

  it('resolves a normal relative path', () => {
    const result = safePath(base, 'src/app.ts');
    expect(result).toBe(resolve(base, 'src/app.ts'));
  });

  it('resolves a simple filename', () => {
    const result = safePath(base, 'README.md');
    expect(result).toBe(resolve(base, 'README.md'));
  });

  it('throws on path traversal with ../', () => {
    expect(() => safePath(base, '../etc/passwd')).toThrow('Path traversal');
  });

  it('throws on path traversal with deep ../../../', () => {
    expect(() => safePath(base, '../../../etc/shadow')).toThrow('Path traversal');
  });

  it('throws on absolute path outside base', () => {
    const outside = isWin ? 'C:\\Windows\\System32\\cmd.exe' : '/etc/passwd';
    expect(() => safePath(base, outside)).toThrow('Path traversal');
  });

  it('allows nested subdirectories', () => {
    const result = safePath(base, 'src/core/git/types/index.ts');
    expect(result).toBe(resolve(base, 'src/core/git/types/index.ts'));
  });

  it('handles path with ./ prefix', () => {
    const result = safePath(base, './src/app.ts');
    expect(result).toBe(resolve(base, 'src/app.ts'));
  });

  it('throws on path that escapes via ../ in the middle', () => {
    expect(() => safePath(base, 'src/../../outside')).toThrow('Path traversal');
  });

  it('allows paths that contain .. as part of filename', () => {
    const result = safePath(base, 'src/..hidden-file');
    expect(result).toBe(resolve(base, 'src/..hidden-file'));
  });
});

describe('safePath case-insensitive FS (darwin/win32)', () => {
  afterEach(() => {
    restorePlatform();
  });

  it('on darwin: rejects ../ traversal even with case mismatch', () => {
    // На macOS APFS case-insensitive по дефолту, но `../etc/passwd` всё
    // равно выходит за пределы базы и должен отбиваться.
    setPlatform('darwin');
    const base = resolve('/tmp/Test-Repo');
    expect(() => safePath(base, '../etc/passwd')).toThrow('Path traversal');
  });

  it('on darwin: rejects traversal that walks out via case-mismatched parent', () => {
    // base = /tmp/Test-Repo, путь `../OtherRepo/secret` после resolve =
    // /tmp/OtherRepo/secret — это совершенно другая директория, должна
    // отбиваться независимо от case-insensitive семантики FS.
    setPlatform('darwin');
    const base = resolve('/tmp/Test-Repo');
    expect(() => safePath(base, '../OtherRepo/secret')).toThrow('Path traversal');
  });

  it('on linux: case-sensitive — путь с другим регистром базы воспринимается как traversal', () => {
    // На linux ext4 регистры различаются. `/tmp/Test-Repo` и `/tmp/test-repo` —
    // разные директории. resolve('/tmp/Test-Repo', '../test-repo/x') = '/tmp/test-repo/x',
    // что НЕ внутри базы — должно отбиваться.
    setPlatform('linux');
    const base = resolve('/tmp/Test-Repo');
    expect(() => safePath(base, '../test-repo/secret')).toThrow('Path traversal');
  });
});

describe('isSafeFilename', () => {
  it('accepts simple alphanumeric names', () => {
    expect(isSafeFilename('id_rsa')).toBe(true);
    expect(isSafeFilename('my-key')).toBe(true);
    expect(isSafeFilename('key.pub')).toBe(true);
  });

  it('rejects names with path separators', () => {
    expect(isSafeFilename('path/key')).toBe(false);
    expect(isSafeFilename('path\\key')).toBe(false);
  });

  it('rejects names with ..', () => {
    expect(isSafeFilename('..key')).toBe(false);
    expect(isSafeFilename('a..b')).toBe(false);
  });

  it('rejects names with spaces or special chars', () => {
    expect(isSafeFilename('my key')).toBe(false);
    expect(isSafeFilename('key;rm -rf')).toBe(false);
    expect(isSafeFilename('key$(cmd)')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isSafeFilename('')).toBe(false);
  });
});
