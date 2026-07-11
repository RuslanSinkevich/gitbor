import { describe, it, expect, vi } from 'vitest';
import { resolveStashDropRef } from '../../src/core/git/stashRef';

describe('resolveStashDropRef', () => {
  it('passes through stash@{n} without listing', async () => {
    const exec = vi.fn();
    await expect(resolveStashDropRef({ exec }, 'stash@{3}')).resolves.toBe('stash@{3}');
    expect(exec).not.toHaveBeenCalled();
  });

  it('resolves full hash to stash@{n}', async () => {
    const exec = vi.fn(async () => ({
      stdout: 'stash@{0}\x00aaa111\nstash@{1}\x00bbb222\n',
      stderr: '',
      exitCode: 0,
    }));
    await expect(resolveStashDropRef({ exec }, 'bbb222')).resolves.toBe('stash@{1}');
  });

  it('resolves short hash prefix', async () => {
    const exec = vi.fn(async () => ({
      stdout: 'stash@{0}\x00abcdef0123456789\n',
      stderr: '',
      exitCode: 0,
    }));
    await expect(resolveStashDropRef({ exec }, 'abcdef0')).resolves.toBe('stash@{0}');
  });

  it('returns null when hash not in list', async () => {
    const exec = vi.fn(async () => ({
      stdout: 'stash@{0}\x00aaa\n',
      stderr: '',
      exitCode: 0,
    }));
    await expect(resolveStashDropRef({ exec }, 'zzz')).resolves.toBeNull();
  });

  it('returns null for empty input', async () => {
    await expect(resolveStashDropRef({ exec: vi.fn() }, '  ')).resolves.toBeNull();
  });
});
