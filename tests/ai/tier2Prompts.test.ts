import { describe, it, expect } from 'vitest';
import { DEFAULT_PROMPTS, resolvePrompt } from '../../src/core/ai/prompts';
import { applyPlaceholders } from '../../src/core/ai/AiHandlers';

/*
 * Smoke-проверки на сборку Tier-2 промптов: формула «resolvePrompt(id, cfg)
 * + applyPlaceholders(template, {placeholders})» должна давать корректный
 * текст с подставленными переменными и языковой инструкцией.
 */

describe('Tier-2 prompt assembly', () => {
  it('explainCommit substitutes {subject} and {body} placeholders', () => {
    const tpl = resolvePrompt('explainCommit', { baseUrl: 'http://x', apiKey: '', model: 'm' });
    const out = applyPlaceholders(tpl, { subject: 'fix(api): handle nulls', body: 'short body' });
    expect(out).toContain('fix(api): handle nulls');
    expect(out).toContain('short body');
    expect(out).not.toContain('{subject}');
    expect(out).not.toContain('{body}');
  });

  it('explainCommit ru appends Russian instruction at the end', () => {
    const tpl = resolvePrompt('explainCommit', { baseUrl: 'http://x', apiKey: '', model: 'm', aiResponseLanguage: 'ru' });
    expect(tpl).toMatch(/Respond strictly in Russian/);
  });

  it('stashName is always English even with ru response language', () => {
    const tpl = resolvePrompt('stashName', { baseUrl: 'http://x', apiKey: '', model: 'm', aiResponseLanguage: 'ru' });
    expect(tpl).not.toMatch(/Respond strictly in/);
    expect(tpl).toBe(DEFAULT_PROMPTS.stashName);
  });

  it('explainReflog substitutes nothing — body comes as userPrompt', () => {
    const tpl = resolvePrompt('explainReflog', { baseUrl: 'http://x', apiKey: '', model: 'm' });
    expect(tpl).toContain('git reflog');
  });

  it('analyzeConflict prompt forbids proposing a solution', () => {
    const tpl = resolvePrompt('analyzeConflict', { baseUrl: 'http://x', apiKey: '', model: 'm' });
    expect(tpl).toMatch(/do NOT propose a merged solution/);
  });
});
