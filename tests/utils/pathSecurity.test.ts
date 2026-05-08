import { describe, it, expect } from 'vitest';
import { safePath, isSafeFilename } from '@core/utils/pathSecurity';
import { resolve } from 'path';

const isWin = process.platform === 'win32';

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
