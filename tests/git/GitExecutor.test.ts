import { describe, it, expect } from 'vitest';

/**
 * Test the sanitizeArgs logic from GitExecutor.
 * Since sanitizeArgs is private, we extract the logic and test it directly.
 */

const REDACT_FLAGS = new Set(['-m', '-N', '-C', '--message']);

function sanitizeArgs(args: string[]): string {
  const sanitized: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      sanitized.push('<redacted>');
      redactNext = false;
    } else if (REDACT_FLAGS.has(arg)) {
      sanitized.push(arg);
      redactNext = true;
    } else {
      sanitized.push(arg);
    }
  }
  return sanitized.join(' ');
}

/**
 * Test the resolveTimeout logic from GitExecutor.
 * Same trick as for sanitizeArgs: the static method is private, so we
 * mirror the implementation here. Must stay in sync with `GitExecutor.ts`.
 */
const LONG_RUNNING_COMMANDS = new Set<string>([
  'commit', 'merge', 'rebase', 'cherry-pick', 'revert',
  'pull', 'push', 'fetch', 'clone', 'checkout',
]);
const LONG_RUNNING_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;

function resolveTimeout(args: string[], explicit: number | undefined): number {
  if (typeof explicit === 'number') return explicit;
  const head = args[0];
  if (head && LONG_RUNNING_COMMANDS.has(head)) return LONG_RUNNING_TIMEOUT_MS;
  return DEFAULT_TIMEOUT_MS;
}

describe('GitExecutor.resolveTimeout', () => {
  it('uses 30s default for read-only commands', () => {
    expect(resolveTimeout(['status', '--porcelain'], undefined)).toBe(30_000);
    expect(resolveTimeout(['log', '--all'], undefined)).toBe(30_000);
    expect(resolveTimeout(['rev-parse', 'HEAD'], undefined)).toBe(30_000);
    expect(resolveTimeout(['for-each-ref'], undefined)).toBe(30_000);
    expect(resolveTimeout(['diff', '--cached'], undefined)).toBe(30_000);
  });

  it('uses 15min default for mutating / network / hook-heavy commands', () => {
    const long = 15 * 60_000;
    expect(resolveTimeout(['commit', '-m', 'x'], undefined)).toBe(long);
    expect(resolveTimeout(['merge', 'feature'], undefined)).toBe(long);
    expect(resolveTimeout(['rebase', '-i', 'main'], undefined)).toBe(long);
    expect(resolveTimeout(['cherry-pick', 'abc'], undefined)).toBe(long);
    expect(resolveTimeout(['revert', 'abc'], undefined)).toBe(long);
    expect(resolveTimeout(['pull'], undefined)).toBe(long);
    expect(resolveTimeout(['push', 'origin', 'main'], undefined)).toBe(long);
    expect(resolveTimeout(['fetch', '--all'], undefined)).toBe(long);
    expect(resolveTimeout(['clone', 'url', 'dir'], undefined)).toBe(long);
    expect(resolveTimeout(['checkout', 'branch'], undefined)).toBe(long);
  });

  it('explicit timeout overrides every default', () => {
    expect(resolveTimeout(['status'], 5_000)).toBe(5_000);
    expect(resolveTimeout(['commit', '-m', 'x'], 60_000)).toBe(60_000);
    expect(resolveTimeout(['push'], 0)).toBe(0);
  });

  it('falls back to default when args[0] is missing', () => {
    expect(resolveTimeout([], undefined)).toBe(30_000);
  });
});

describe('GitExecutor.sanitizeArgs', () => {
  it('passes through normal args', () => {
    expect(sanitizeArgs(['status', '--porcelain'])).toBe('status --porcelain');
  });

  it('redacts commit message after -m', () => {
    expect(sanitizeArgs(['commit', '-m', 'secret fix for password leak'])).toBe(
      'commit -m <redacted>',
    );
  });

  it('redacts passphrase after -N', () => {
    expect(sanitizeArgs(['-t', 'ed25519', '-N', 'my-secret-pass'])).toBe(
      '-t ed25519 -N <redacted>',
    );
  });

  it('redacts comment after -C', () => {
    expect(sanitizeArgs(['tag', '-a', 'v1.0', '-C', 'some message'])).toBe(
      'tag -a v1.0 -C <redacted>',
    );
  });

  it('redacts --message value', () => {
    expect(sanitizeArgs(['commit', '--message', 'do not leak'])).toBe(
      'commit --message <redacted>',
    );
  });

  it('handles -m at end of args gracefully', () => {
    expect(sanitizeArgs(['commit', '-m'])).toBe('commit -m');
  });

  it('handles multiple redactable flags', () => {
    expect(sanitizeArgs(['tag', '-m', 'tag msg', '-C', 'reuse'])).toBe(
      'tag -m <redacted> -C <redacted>',
    );
  });
});
