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
