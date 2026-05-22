import { describe, it, expect } from 'vitest';
import { countCheckoutDirty } from '../../src/renderer/src/features/checkout/checkoutDirty';

describe('countCheckoutDirty', () => {
  it('counts staged and unstaged paths', () => {
    expect(countCheckoutDirty(
      [{ path: 'a.ts', status: 'M' }],
      [{ path: 'b.ts', status: 'M' }],
    )).toBe(2);
  });

  it('dedupes same path in staged and unstaged', () => {
    expect(countCheckoutDirty(
      [{ path: 'a.ts', status: 'M' }],
      [{ path: 'a.ts', status: 'M' }],
    )).toBe(1);
  });

  it('ignores stat-dirty unstaged files', () => {
    expect(countCheckoutDirty(
      [],
      [{ path: 'touch.ts', status: 'M', statDirty: true }],
    )).toBe(0);
  });
});
