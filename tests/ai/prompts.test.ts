import { describe, it, expect } from 'vitest';
import {
  buildCommitSystemPrompt,
  buildCommitUserPrompt,
  DEFAULT_COMMIT_SYSTEM_PROMPT,
  DEFAULT_PROMPTS,
  MAX_DIFF_CHARS,
  resolvePrompt,
  resolveResponseLanguage,
} from '../../src/core/ai/prompts';
import type { AiProviderConfig } from '../../src/core/ai/types';

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

function cfg(over: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return { baseUrl: 'http://x', apiKey: '', model: 'm', ...over };
}

describe('resolvePrompt', () => {
  it('uses DEFAULT_PROMPTS when no override is set', () => {
    const out = resolvePrompt('commitMessage', cfg());
    expect(out.startsWith(DEFAULT_PROMPTS.commitMessage)).toBe(true);
  });

  it('prefers user-provided prompt over default', () => {
    const out = resolvePrompt('commitMessage', cfg({ prompts: { commitMessage: 'CUSTOM' } }));
    expect(out.startsWith('CUSTOM')).toBe(true);
  });

  it('falls back to default when override is empty/whitespace', () => {
    const out = resolvePrompt('commitMessage', cfg({ prompts: { commitMessage: '   ' } }));
    expect(out.startsWith(DEFAULT_PROMPTS.commitMessage)).toBe(true);
  });

  it('does NOT append language instruction for en', () => {
    const out = resolvePrompt('commitMessage', cfg({ aiResponseLanguage: 'en' }));
    expect(out).not.toMatch(/Respond strictly in/);
  });

  it('appends Russian instruction for ru', () => {
    const out = resolvePrompt('commitMessage', cfg({ aiResponseLanguage: 'ru' }));
    expect(out).toMatch(/Respond strictly in Russian\. Do not switch language mid-response\./);
  });

  it('stashName always returns English even when aiResponseLanguage=ru', () => {
    const out = resolvePrompt('stashName', cfg({ aiResponseLanguage: 'ru' }));
    expect(out).toBe(DEFAULT_PROMPTS.stashName);
    expect(out).not.toMatch(/Respond strictly in/);
  });

  it('stashName ignores user-provided prompts language wrapping', () => {
    const out = resolvePrompt('stashName', cfg({
      aiResponseLanguage: 'ru',
      prompts: { stashName: 'short name only' },
    }));
    expect(out).toBe('short name only');
  });

  it('treats null config as en defaults', () => {
    const out = resolvePrompt('commitMessage', null);
    expect(out).toBe(DEFAULT_PROMPTS.commitMessage);
  });
});

describe('resolveResponseLanguage', () => {
  it('returns fallback for auto', () => {
    expect(resolveResponseLanguage(cfg({ aiResponseLanguage: 'auto' }), 'ru')).toBe('ru');
    expect(resolveResponseLanguage(cfg({ aiResponseLanguage: 'auto' }), 'en')).toBe('en');
  });

  it('returns explicit language unchanged', () => {
    expect(resolveResponseLanguage(cfg({ aiResponseLanguage: 'ru' }))).toBe('ru');
    expect(resolveResponseLanguage(cfg({ aiResponseLanguage: 'en' }))).toBe('en');
  });

  it('handles null / missing field', () => {
    expect(resolveResponseLanguage(null)).toBe('en');
    expect(resolveResponseLanguage(cfg(), 'ru')).toBe('ru');
  });
});
