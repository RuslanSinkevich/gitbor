import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion } from '../../src/core/utils/semver';

describe('compareVersions', () => {
  it('orders by numeric components', () => {
    expect(compareVersions('0.1.17', '0.1.16')).toBe(1);
    expect(compareVersions('0.1.16', '0.1.17')).toBe(-1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.1.17', '0.1.17')).toBe(0);
  });

  it('treats missing components as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.1', '1.2')).toBe(1);
  });

  it('ignores pre-release/build suffixes and leading v', () => {
    expect(compareVersions('v0.1.17', '0.1.17')).toBe(0);
    expect(compareVersions('0.2.0-beta.1', '0.1.17')).toBe(1);
  });
});

describe('isNewerVersion', () => {
  it('is true only when remote is strictly newer', () => {
    expect(isNewerVersion('0.1.18', '0.1.17')).toBe(true);
    expect(isNewerVersion('0.1.16', '0.1.17')).toBe(false);
    expect(isNewerVersion('0.1.17', '0.1.17')).toBe(false);
  });
});
