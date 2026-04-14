import { describe, it, expect } from 'vitest';
import type { BisectStatus } from '../../src/core/git/BisectManager';

describe('BisectStatus (contract)', () => {
  it('inactive status has correct shape', () => {
    const status: BisectStatus = {
      active: false,
      current: '',
      stepsLeft: 0,
      goodCount: 0,
      badCount: 0,
      log: [],
    };
    expect(status.active).toBe(false);
    expect(status.log).toEqual([]);
  });

  it('active status has correct shape', () => {
    const status: BisectStatus = {
      active: true,
      current: 'abc1234',
      stepsLeft: 5,
      goodCount: 2,
      badCount: 1,
      log: ['git bisect bad abc', 'git bisect good def'],
    };
    expect(status.active).toBe(true);
    expect(status.current).toBe('abc1234');
    expect(status.stepsLeft).toBe(5);
    expect(status.log).toHaveLength(2);
  });
});
