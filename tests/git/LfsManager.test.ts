import { describe, it, expect } from 'vitest';
import type { LfsStatus, LfsFile, LfsPattern } from '../../src/core/git/LfsManager';

describe('LfsManager types (contract)', () => {
  it('LfsStatus not installed', () => {
    const status: LfsStatus = { installed: false, patterns: [], files: [] };
    expect(status.installed).toBe(false);
    expect(status.patterns).toEqual([]);
    expect(status.files).toEqual([]);
  });

  it('LfsStatus installed with data', () => {
    const pattern: LfsPattern = { pattern: '*.psd' };
    const file: LfsFile = { name: 'logo.psd', size: '*', oid: 'abc1234567' };
    const status: LfsStatus = { installed: true, patterns: [pattern], files: [file] };

    expect(status.installed).toBe(true);
    expect(status.patterns).toHaveLength(1);
    expect(status.patterns[0].pattern).toBe('*.psd');
    expect(status.files[0].name).toBe('logo.psd');
    expect(status.files[0].oid).toBe('abc1234567');
  });
});
