import { describe, it, expect } from 'vitest';
import { colorForAuthor } from '../../src/renderer/src/shared/authorColor';

describe('colorForAuthor', () => {
  it('returns a stable triple for the same email', () => {
    const a = colorForAuthor('a@b.com', 'Ivan');
    const b = colorForAuthor('a@b.com', 'Ivan');
    expect(a.bg).toBe(b.bg);
    expect(a.fg).toBe(b.fg);
    expect(a.initials).toBe(b.initials);
  });

  it('normalizes email case (A@B.COM === a@b.com)', () => {
    const upper = colorForAuthor('A@B.COM', 'Ivan');
    const lower = colorForAuthor('a@b.com', 'Ivan');
    expect(upper.bg).toBe(lower.bg);
  });

  it('extracts ASCII two-word initials', () => {
    expect(colorForAuthor('ivan.ivanov@example.com', 'Ivan Ivanov').initials).toBe('II');
  });

  it('supports Cyrillic initials', () => {
    expect(colorForAuthor('ivan@example.com', 'Иван Иванов').initials).toBe('ИИ');
  });

  it('handles single-word names of length >= 2', () => {
    expect(colorForAuthor('madonna@x', 'Madonna').initials).toBe('MA');
  });

  it('handles single-letter single-word names', () => {
    expect(colorForAuthor('x@x', 'X').initials).toBe('X');
  });

  it('falls back to email local part when name is empty', () => {
    expect(colorForAuthor('ivanov@example.com').initials).toBe('IV');
  });

  it('falls back to email local part when name has no letters', () => {
    expect(colorForAuthor('ruslan@example.com', '!@#$%').initials).toBe('RU');
  });

  it('ignores leading punctuation in name and still extracts letters', () => {
    expect(colorForAuthor('boris@x', 'Boris!@#').initials).toBe('BO');
  });

  it('produces neutral grey "?" avatar when both email and name are empty', () => {
    const v = colorForAuthor('', '');
    expect(v.initials).toBe('?');
    expect(v.bg).toBe('hsl(0, 0%, 50%)');
    expect(v.fg).toBe('#ffffff');
  });

  it('returns "?" initials when only an at-sign email without letters is provided', () => {
    expect(colorForAuthor('123@456').initials).toBe('?');
  });

  it('generates different hues for different authors (5 distinct samples)', () => {
    const samples = ['a@b', 'c@d', 'e@f', 'g@h', 'ivan@x'];
    const hues = new Set(samples.map(e => colorForAuthor(e).bg));
    expect(hues.size).toBe(samples.length);
  });

  it('handles email without @ gracefully (treats whole string as local part)', () => {
    const v = colorForAuthor('plainstring');
    expect(v.initials).toBe('PL');
    // Палитра — насыщенные цвета: hue 0-359, saturation 60-85, lightness 42-58.
    expect(v.bg).toMatch(/^hsl\(\d+, (?:6\d|7\d|8[0-5])%, (?:4[2-9]|5[0-8])%\)$/);
  });

  it('picks readable foreground based on background lightness', () => {
    const v = colorForAuthor('any@one.com', 'Any One');
    expect(['#ffffff', '#1a1a1a']).toContain(v.fg);
  });

  it('uses email for hue, even when name differs (same person, different display name)', () => {
    const a = colorForAuthor('shared@x.com', 'Display One');
    const b = colorForAuthor('shared@x.com', 'Display Two');
    expect(a.bg).toBe(b.bg);
  });

  it('falls back to name as hue key when email is empty', () => {
    const a = colorForAuthor('', 'Solo Author');
    const b = colorForAuthor('', 'Solo Author');
    const c = colorForAuthor('', 'Other Author');
    expect(a.bg).toBe(b.bg);
    expect(a.bg).not.toBe(c.bg);
  });
});
