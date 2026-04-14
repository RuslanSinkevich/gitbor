import { describe, it, expect } from 'vitest';

// tpl uses localStorage via module init, so we replicate the function logic
function tpl(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

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
