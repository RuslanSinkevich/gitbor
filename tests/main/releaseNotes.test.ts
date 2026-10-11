import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseReleaseNotes } from '../../src/main/releaseNotes';

describe('parseReleaseNotes', () => {
  it('разбирает блоки ru/en по маркерам', () => {
    const r = parseReleaseNotes('<!-- ru -->\n- Пункт 1\n- Пункт 2\n<!-- en -->\n- Item 1\n');
    expect(r).toEqual({ ru: ['Пункт 1', 'Пункт 2'], en: ['Item 1'] });
  });

  it('CRLF и HTML-теги (generic provider может отдать HTML)', () => {
    const r = parseReleaseNotes('<!-- ru -->\r\n- <b>Жирно</b> и ок\r\n');
    expect(r).toEqual({ ru: ['Жирно и ок'], en: [] });
  });

  it('массив { version, note } (fullChangelog)', () => {
    const r = parseReleaseNotes([{ version: '0.1.22', note: '<!-- ru -->\n- А\n<!-- en -->\n- A' }]);
    expect(r).toEqual({ ru: ['А'], en: ['A'] });
  });

  it('без маркеров — считаем русским', () => {
    expect(parseReleaseNotes('- Просто пункт')).toEqual({ ru: ['Просто пункт'], en: [] });
  });

  it('пусто / null / не строка — undefined (модалка без списка, фоллбэк на сайт)', () => {
    expect(parseReleaseNotes('')).toBeUndefined();
    expect(parseReleaseNotes(null)).toBeUndefined();
    expect(parseReleaseNotes(42)).toBeUndefined();
  });

  it('build/release-notes.md разбирается: оба языка, одинаковое число пунктов', () => {
    const raw = readFileSync(join(__dirname, '../../build/release-notes.md'), 'utf8');
    const r = parseReleaseNotes(raw)!;
    expect(r.ru.length).toBeGreaterThan(0);
    expect(r.en.length).toBe(r.ru.length);
  });
});
