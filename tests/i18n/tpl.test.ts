import { describe, it, expect, vi } from 'vitest';

// Mock browser globals that i18n/index.ts accesses on load
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });

const { tpl } = await import('../../src/renderer/src/i18n/index');

describe('tpl (template interpolation)', () => {
  it('replaces single placeholder', () => {
    expect(tpl('Hello {name}', { name: 'World' })).toBe('Hello World');
  });

  it('replaces multiple placeholders', () => {
    expect(tpl('{a} and {b}', { a: '1', b: '2' })).toBe('1 and 2');
  });

  it('replaces numeric values', () => {
    expect(tpl('{count} items', { count: 5 })).toBe('5 items');
  });

  it('keeps placeholder if key missing', () => {
    expect(tpl('Hello {name}', {})).toBe('Hello {name}');
  });

  it('handles no placeholders', () => {
    expect(tpl('plain text', { x: 'y' })).toBe('plain text');
  });

  it('handles same placeholder twice', () => {
    expect(tpl('{x} + {x}', { x: '1' })).toBe('1 + 1');
  });

  it('handles empty template', () => {
    expect(tpl('', { x: '1' })).toBe('');
  });
});
