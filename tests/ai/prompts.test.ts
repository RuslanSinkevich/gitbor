import { describe, it, expect } from 'vitest';
import {
  buildCommitSystemPrompt,
  buildCommitUserPrompt,
  DEFAULT_COMMIT_SYSTEM_PROMPT,
  MAX_DIFF_CHARS,
} from '../../src/core/ai/prompts';

describe('buildCommitUserPrompt', () => {
  it('includes diff verbatim when under limit', () => {
    const diff = 'diff --git a/x b/x\n+hi';
    const out = buildCommitUserPrompt(diff);
    expect(out).toContain(diff);
  });

  it('truncates diff longer than MAX_DIFF_CHARS with marker', () => {
    const big = 'a'.repeat(MAX_DIFF_CHARS + 5000);
    const out = buildCommitUserPrompt(big);
    expect(out.length).toBeLessThan(big.length);
    expect(out).toContain('diff truncated');
  });

  it('keeps both head and tail of a long diff', () => {
    const head = 'HEAD_MARKER_ABC';
    const tail = 'TAIL_MARKER_XYZ';
    const big = head + 'x'.repeat(MAX_DIFF_CHARS) + tail;
    const out = buildCommitUserPrompt(big);
    expect(out).toContain(head);
    expect(out).toContain(tail);
  });
});

describe('buildCommitSystemPrompt', () => {
  it('does not add language line for auto', () => {
    const s = buildCommitSystemPrompt('auto');
    expect(s).toBe(DEFAULT_COMMIT_SYSTEM_PROMPT);
    expect(s).not.toMatch(/Write the commit message in/);
  });

  it('adds English instruction for en', () => {
    const s = buildCommitSystemPrompt('en');
    expect(s).toMatch(/commit message in English/);
  });

  it('adds Russian instruction for ru', () => {
    const s = buildCommitSystemPrompt('ru');
    expect(s).toMatch(/commit message in Russian/);
    expect(s).toMatch(/русском языке/);
  });
});
