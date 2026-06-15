import { describe, it, expect } from 'vitest';
import { stripAnsi } from '../../src/renderer/src/shared/stripAnsi';

describe('stripAnsi', () => {
  it('removes color escape sequences from chalk-like output', () => {
    const input = '\u001b[33m[STARTED]\u001b[39m Backing up original state...';
    expect(stripAnsi(input)).toBe('[STARTED] Backing up original state...');
  });

  it('removes complex multi-segment sequences', () => {
    const input =
      '\u001b[33m[STARTED]\u001b[39m \u001b[33m.lintstagedrc.json\u001b[39m — 26 files (chunk 1/2)...';
    expect(stripAnsi(input)).toBe('[STARTED] .lintstagedrc.json — 26 files (chunk 1/2)...');
  });

  it('passes plain text through untouched', () => {
    expect(stripAnsi('plain text without codes')).toBe('plain text without codes');
  });

  it('handles null / undefined / empty safely', () => {
    expect(stripAnsi(null)).toBe('');
    expect(stripAnsi(undefined)).toBe('');
    expect(stripAnsi('')).toBe('');
  });

  it('strips cursor-position style sequences too', () => {
    expect(stripAnsi('\u001b[2K\u001b[1G> rebuilt')).toBe('> rebuilt');
  });
});
