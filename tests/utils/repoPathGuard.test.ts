import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { isDangerousRepoRoot } from '@core/utils/repoPathGuard';

const isWin = process.platform === 'win32';

let originalPlatform: PropertyDescriptor | undefined;
function setPlatform(p: NodeJS.Platform): void {
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
function restorePlatform(): void {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  originalPlatform = undefined;
}

describe('isDangerousRepoRoot', () => {
  it('rejects empty / non-string', () => {
    expect(isDangerousRepoRoot('').dangerous).toBe(true);
    // @ts-expect-error — runtime check
    expect(isDangerousRepoRoot(undefined).dangerous).toBe(true);
  });

  it('rejects current user home directory', () => {
    const home = os.homedir();
    if (!home) return;
    const r = isDangerousRepoRoot(home);
    expect(r.dangerous).toBe(true);
    expect(r.reason).toBe('homeDirectory');
  });

  it('rejects FS root', () => {
    if (isWin) {
      expect(isDangerousRepoRoot('C:\\').dangerous).toBe(true);
      expect(isDangerousRepoRoot('D:/').dangerous).toBe(true);
      expect(isDangerousRepoRoot('e:').dangerous).toBe(true);
    } else {
      expect(isDangerousRepoRoot('/').dangerous).toBe(true);
    }
  });

  it('rejects \\Users root on Windows', () => {
    if (!isWin) return;
    expect(isDangerousRepoRoot('C:\\Users').dangerous).toBe(true);
    expect(isDangerousRepoRoot('C:\\Users\\').dangerous).toBe(true);
  });

  it('rejects Windows system roots and their children', () => {
    if (!isWin) return;
    expect(isDangerousRepoRoot('C:\\Windows').dangerous).toBe(true);
    expect(isDangerousRepoRoot('C:\\Windows\\System32').dangerous).toBe(true);
    expect(isDangerousRepoRoot('C:\\Program Files').dangerous).toBe(true);
    expect(isDangerousRepoRoot('C:\\Program Files (x86)\\foo').dangerous).toBe(true);
    expect(isDangerousRepoRoot('C:\\ProgramData').dangerous).toBe(true);
  });

  it('rejects POSIX system roots', () => {
    if (isWin) return;
    expect(isDangerousRepoRoot('/etc').dangerous).toBe(true);
    expect(isDangerousRepoRoot('/etc/foo').dangerous).toBe(true);
    expect(isDangerousRepoRoot('/usr').dangerous).toBe(true);
    expect(isDangerousRepoRoot('/var/log').dangerous).toBe(true);
    expect(isDangerousRepoRoot('/home').dangerous).toBe(true);
    expect(isDangerousRepoRoot('/Users').dangerous).toBe(true);
  });

  it('allows a normal subfolder under home', () => {
    const home = os.homedir();
    if (!home) return;
    const sub = path.join(home, 'projects', 'my-repo');
    expect(isDangerousRepoRoot(sub).dangerous).toBe(false);
  });

  it('allows arbitrary project paths', () => {
    if (isWin) {
      expect(isDangerousRepoRoot('D:\\Work\\skyfork').dangerous).toBe(false);
      expect(isDangerousRepoRoot('C:\\repos\\my-app').dangerous).toBe(false);
    } else {
      expect(isDangerousRepoRoot('/home/alice/projects/x').dangerous).toBe(false);
      expect(isDangerousRepoRoot('/Users/alice/code').dangerous).toBe(false);
    }
  });
});

describe('isDangerousRepoRoot — /Applications + case-insensitive FS', () => {
  afterEach(() => {
    restorePlatform();
  });

  it('darwin: blocks exactly /Applications as systemDirectory', () => {
    setPlatform('darwin');
    const r = isDangerousRepoRoot('/Applications');
    expect(r.dangerous).toBe(true);
    expect(r.reason).toBe('systemDirectory');
  });

  it('darwin: blocks /Applications/SkyFork.app/Contents as systemDirectory', () => {
    setPlatform('darwin');
    const r = isDangerousRepoRoot('/Applications/SkyFork.app/Contents');
    expect(r.dangerous).toBe(true);
    expect(r.reason).toBe('systemDirectory');
  });

  it('darwin: blocks /applications/foo (lowercase, case-insensitive)', () => {
    setPlatform('darwin');
    const r = isDangerousRepoRoot('/applications/foo');
    expect(r.dangerous).toBe(true);
    expect(r.reason).toBe('systemDirectory');
  });

  it('darwin: blocks /LIBRARY/Preferences (uppercase, case-insensitive)', () => {
    setPlatform('darwin');
    const r = isDangerousRepoRoot('/LIBRARY/Preferences');
    expect(r.dangerous).toBe(true);
    expect(r.reason).toBe('systemDirectory');
  });

  it('linux: does NOT match /applications/foo case-insensitively', () => {
    setPlatform('linux');
    const r = isDangerousRepoRoot('/applications/foo');
    expect(r.dangerous).toBe(false);
  });
});
