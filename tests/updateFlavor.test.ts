import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectUpdateArtifactNames,
  decideUpdateAcceptance,
  isNoAiArtifactName,
  isUpdateArtifactMatchingFlavor,
  resolveUpdateChannel,
  resolveUpdateFeed,
  resolveUpdateFeedDir,
  resolveUpdateFeedUrl,
  GITHUB_UPDATE_REPO,
  pickMacDmg,
  resolveUpdateAssetUrl,
} from '../src/main/updateFlavor';

/** Реальные имена из бакета / electron-builder artifactName. */
const AI_WIN_SETUP = 'GitBor-Setup-0.1.19.exe';
const AI_WIN_PORTABLE = 'GitBor-Portable-0.1.19.exe';
const NOAI_WIN_SETUP = 'GitBor-NoAI-Setup-0.1.19.exe';
const NOAI_WIN_PORTABLE = 'GitBor-NoAI-Portable-0.1.19.exe';
const AI_LINUX = 'GitBor-0.1.19.AppImage';
const NOAI_LINUX = 'GitBor-NoAI-0.1.19.AppImage';
const AI_MAC = 'GitBor-0.1.19.dmg';
const NOAI_MAC = 'GitBor-NoAI-0.1.19.dmg';

function latestYmlShape(fileName: string) {
  return {
    version: '0.1.19',
    path: fileName,
    files: [{ url: fileName, sha512: 'x', size: 1 }],
  };
}

describe('isNoAiArtifactName', () => {
  it.each([
    [NOAI_WIN_SETUP, true],
    [NOAI_WIN_PORTABLE, true],
    [NOAI_LINUX, true],
    [NOAI_MAC, true],
    ['gitbor-noai-setup-0.1.19.exe', true],
    [AI_WIN_SETUP, false],
    [AI_WIN_PORTABLE, false],
    [AI_LINUX, false],
    [AI_MAC, false],
    ['GitBor.exe', false],
    // «No AI» в productName пути к unpacked — не артефакт апдейта, но
    // basename без NoAI-маркера в имени файла → false (так и должно).
    ['GitBor No AI.exe', false],
  ] as const)('%s → %s', (name, expected) => {
    expect(isNoAiArtifactName(name)).toBe(expected);
  });

  it('смотрит только basename (cache path / URL path)', () => {
    expect(isNoAiArtifactName(`C:\\Users\\x\\AppData\\Local\\gitbor-updater\\pending\\${AI_WIN_SETUP}`)).toBe(false);
    expect(isNoAiArtifactName(`C:\\Users\\x\\AppData\\Local\\gitbor-noai-updater\\pending\\${NOAI_WIN_SETUP}`)).toBe(true);
    expect(isNoAiArtifactName(`https://storage.yandexcloud.net/gitbor/stable/win/${AI_WIN_SETUP}`)).toBe(false);
    expect(isNoAiArtifactName(`https://storage.yandexcloud.net/gitbor/stable/win/no_ai/${NOAI_WIN_SETUP}`)).toBe(true);
  });
});

describe('isUpdateArtifactMatchingFlavor — matrix', () => {
  const cases: Array<{
    label: string;
    flavor: string;
    file: string;
    ok: boolean;
  }> = [
    { label: 'no-ai + NoAI Setup', flavor: 'no-ai', file: NOAI_WIN_SETUP, ok: true },
    { label: 'no-ai + AI Setup (THE BUG)', flavor: 'no-ai', file: AI_WIN_SETUP, ok: false },
    { label: 'no-ai + AI Portable', flavor: 'no-ai', file: AI_WIN_PORTABLE, ok: false },
    { label: 'standard + AI Setup', flavor: 'standard', file: AI_WIN_SETUP, ok: true },
    { label: 'standard + NoAI Setup', flavor: 'standard', file: NOAI_WIN_SETUP, ok: false },
    { label: 'standard + NoAI Portable', flavor: 'standard', file: NOAI_WIN_PORTABLE, ok: false },
    { label: 'no-ai + NoAI AppImage', flavor: 'no-ai', file: NOAI_LINUX, ok: true },
    { label: 'no-ai + AI AppImage', flavor: 'no-ai', file: AI_LINUX, ok: false },
    { label: 'standard + AI dmg', flavor: 'standard', file: AI_MAC, ok: true },
    { label: 'standard + NoAI dmg', flavor: 'standard', file: NOAI_MAC, ok: false },
  ];

  it.each(cases)('$label → $ok', ({ flavor, file, ok }) => {
    expect(isUpdateArtifactMatchingFlavor(latestYmlShape(file), flavor)).toBe(ok);
  });

  it('отклоняет пустой UpdateInfo (нельзя угадывать flavor)', () => {
    expect(isUpdateArtifactMatchingFlavor({}, 'no-ai')).toBe(false);
    expect(isUpdateArtifactMatchingFlavor({ files: [] }, 'standard')).toBe(false);
  });

  it('отклоняет смешанный список (AI + NoAI в одном info)', () => {
    const mixed = {
      path: AI_WIN_SETUP,
      files: [{ url: AI_WIN_SETUP }, { url: NOAI_WIN_SETUP }],
    };
    expect(isUpdateArtifactMatchingFlavor(mixed, 'no-ai')).toBe(false);
    expect(isUpdateArtifactMatchingFlavor(mixed, 'standard')).toBe(false);
  });

  it('downloadedFile тоже учитывается', () => {
    expect(
      isUpdateArtifactMatchingFlavor(
        { downloadedFile: `D:/cache/${AI_WIN_SETUP}`, files: [{ url: AI_WIN_SETUP }] },
        'no-ai',
      ),
    ).toBe(false);
    expect(
      isUpdateArtifactMatchingFlavor(
        { downloadedFile: `D:/cache/${NOAI_WIN_SETUP}`, files: [{ url: NOAI_WIN_SETUP }] },
        'no-ai',
      ),
    ).toBe(true);
  });
});

describe('REGRESSION: No-AI 0.1.17 тянул AI Setup из win/', () => {
  /**
   * Точный сценарий бага: latest.yml с `stable/win/` отдаёт GitBor-Setup,
   * No-AI клиент не должен ни скачивать, ни предлагать install.
   */
  const leakedFromAiFeed = latestYmlShape(AI_WIN_SETUP);

  it('decideUpdateAcceptance: no-ai + AI Setup → flavor-mismatch', () => {
    expect(
      decideUpdateAcceptance({
        remoteVersion: '0.1.19',
        currentVersion: '0.1.17',
        flavor: 'no-ai',
        info: leakedFromAiFeed,
      }),
    ).toEqual({ ok: false, reason: 'flavor-mismatch' });
  });

  it('decideUpdateAcceptance: no-ai + NoAI Setup → accept', () => {
    expect(
      decideUpdateAcceptance({
        remoteVersion: '0.1.19',
        currentVersion: '0.1.17',
        flavor: 'no-ai',
        info: latestYmlShape(NOAI_WIN_SETUP),
      }),
    ).toEqual({ ok: true });
  });

  it('decideUpdateAcceptance: standard + NoAI Setup → flavor-mismatch', () => {
    expect(
      decideUpdateAcceptance({
        remoteVersion: '0.1.19',
        currentVersion: '0.1.17',
        flavor: 'standard',
        info: latestYmlShape(NOAI_WIN_SETUP),
      }),
    ).toEqual({ ok: false, reason: 'flavor-mismatch' });
  });

  it('не предлагает даунгрейд / ту же версию', () => {
    expect(
      decideUpdateAcceptance({
        remoteVersion: '0.1.17',
        currentVersion: '0.1.17',
        flavor: 'no-ai',
        info: latestYmlShape(NOAI_WIN_SETUP),
      }),
    ).toEqual({ ok: false, reason: 'not-newer' });
    expect(
      decideUpdateAcceptance({
        remoteVersion: '0.1.16',
        currentVersion: '0.1.17',
        flavor: 'no-ai',
        info: latestYmlShape(NOAI_WIN_SETUP),
      }),
    ).toEqual({ ok: false, reason: 'not-newer' });
  });

  it('без имён файлов → no-artifacts (fail closed)', () => {
    expect(
      decideUpdateAcceptance({
        remoteVersion: '0.1.19',
        currentVersion: '0.1.17',
        flavor: 'no-ai',
        info: {},
      }),
    ).toEqual({ ok: false, reason: 'no-artifacts' });
  });
});

describe('resolveUpdateFeedDir / resolveUpdateFeedUrl', () => {
  it.each([
    ['win32', 'standard', 'win'],
    ['win32', 'no-ai', 'win/no_ai'],
    ['darwin', 'standard', 'mac'],
    ['darwin', 'no-ai', 'mac/no_ai'],
    ['linux', 'standard', 'linux'],
    ['linux', 'no-ai', 'linux/no_ai'],
  ] as const)('%s + %s → %s', (platform, flavor, dir) => {
    expect(resolveUpdateFeedDir(platform, flavor)).toBe(dir);
  });

  it('no-ai НИКОГДА не получает URL без /no_ai (регрессия 0.1.17)', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const url = resolveUpdateFeedUrl({ platform, flavor: 'no-ai' });
      expect(url).toMatch(/\/no_ai\/$/);
      expect(url).not.toMatch(/\/stable\/win\/$/);
      expect(url).not.toMatch(/\/stable\/mac\/$/);
      expect(url).not.toMatch(/\/stable\/linux\/$/);
    }
  });

  it('standard НИКОГДА не ходит в no_ai', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const url = resolveUpdateFeedUrl({ platform, flavor: 'standard' });
      expect(url).not.toContain('no_ai');
    }
  });

  it('дефолтный base + кастомный GITBOR_UPDATE_BASE_URL', () => {
    expect(resolveUpdateFeedUrl({ platform: 'win32', flavor: 'no-ai' })).toBe(
      'https://storage.yandexcloud.net/gitbor/stable/win/no_ai/',
    );
    expect(
      resolveUpdateFeedUrl({
        platform: 'win32',
        flavor: 'standard',
        baseUrl: 'https://example.test/stable/',
      }),
    ).toBe('https://example.test/stable/win/');
  });
});

describe('resolveUpdateChannel / resolveUpdateFeed (GitHub Releases)', () => {
  it('no-ai читает noai.yml, standard — latest.yml', () => {
    expect(resolveUpdateChannel('no-ai')).toBe('noai');
    expect(resolveUpdateChannel('standard')).toBe('latest');
  });

  it('по умолчанию — github provider со своим каналом на каждую flavor', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(resolveUpdateFeed({ platform, flavor: 'no-ai' })).toEqual({
        provider: 'github',
        ...GITHUB_UPDATE_REPO,
        channel: 'noai',
      });
      expect(resolveUpdateFeed({ platform, flavor: 'standard' })).toEqual({
        provider: 'github',
        ...GITHUB_UPDATE_REPO,
        channel: 'latest',
      });
    }
  });

  it('baseUrl → запасной generic feed, no-ai остаётся в no_ai', () => {
    expect(
      resolveUpdateFeed({ platform: 'linux', flavor: 'no-ai', baseUrl: 'https://example.test/stable' }),
    ).toEqual({ provider: 'generic', url: 'https://example.test/stable/linux/no_ai/' });
  });
});

describe('collectUpdateArtifactNames', () => {
  it('собирает path + downloadedFile + files.url без дыр', () => {
    expect(
      collectUpdateArtifactNames({
        path: AI_WIN_SETUP,
        downloadedFile: `C:\\cache\\${AI_WIN_SETUP}`,
        files: [{ url: AI_WIN_SETUP }, { url: undefined as unknown as string }, {}],
      }),
    ).toEqual([AI_WIN_SETUP, `C:\\cache\\${AI_WIN_SETUP}`, AI_WIN_SETUP]);
  });
});

describe('dist:*:no-ai contract (package.json) — страховка от отката конфига', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
    build: { publish?: { url?: string }; nsis?: { artifactName?: string } };
  };

  it('win no-ai: publish no_ai + NoAI artifactName + отдельный updater name', () => {
    const s = pkg.scripts['dist:win:no-ai'] ?? '';
    expect(s).toContain('GITBOR_AI=0');
    expect(s).toContain('stable/win/no_ai/');
    expect(s).toContain('GitBor-NoAI-Setup-');
    expect(s).toContain('GitBor-NoAI-Portable-');
    expect(s).toContain('extraMetadata.name=gitbor-noai');
    expect(s).toContain('appId=ru.gitbor.app.noai');
    // Нельзя случайно оставить AI publish url
    expect(s).not.toMatch(/publish\.url=https:\/\/storage\.yandexcloud\.net\/gitbor\/stable\/win\/(?!no_ai)/);
  });

  it('mac/linux no-ai: отдельные no_ai feeds и NoAI имена', () => {
    const mac = pkg.scripts['dist:mac:no-ai'] ?? '';
    const linux = pkg.scripts['dist:linux:no-ai'] ?? '';
    expect(mac).toContain('stable/mac/no_ai/');
    expect(mac).toContain('GitBor-NoAI-');
    expect(mac).toContain('extraMetadata.name=gitbor-noai');
    expect(linux).toContain('stable/linux/no_ai/');
    expect(linux).toContain('GitBor-NoAI-');
    expect(linux).toContain('extraMetadata.name=gitbor-noai');
  });

  it('standard publish остаётся на win/ без no_ai', () => {
    expect(pkg.build.publish?.url).toBe('https://storage.yandexcloud.net/gitbor/stable/win/');
    expect(pkg.build.nsis?.artifactName).toContain('${productName}-Setup-');
    expect(pkg.build.nsis?.artifactName).not.toContain('NoAI');
  });
});

describe('pickMacDmg / resolveUpdateAssetUrl', () => {
  const info = {
    path: 'GitBor-0.1.27-x64.dmg',
    files: [{ url: 'GitBor-0.1.27-x64.dmg' }, { url: 'GitBor-0.1.27-arm64.dmg' }],
  };

  it('берёт dmg под архитектуру Mac', () => {
    expect(pickMacDmg(info, 'arm64')).toBe('GitBor-0.1.27-arm64.dmg');
    expect(pickMacDmg(info, 'x64')).toBe('GitBor-0.1.27-x64.dmg');
  });

  it('без dmg под архитектуру — любой dmg, без dmg — ничего', () => {
    expect(pickMacDmg({ files: [{ url: 'GitBor-0.1.19.dmg' }] }, 'arm64')).toBe('GitBor-0.1.19.dmg');
    expect(pickMacDmg({ files: [{ url: 'GitBor-Setup-0.1.19.exe' }] }, 'arm64')).toBeUndefined();
  });

  it('ссылка на GitHub Releases по тегу версии', () => {
    expect(resolveUpdateAssetUrl({ version: '0.1.27', fileName: 'GitBor-0.1.27-arm64.dmg', platform: 'darwin', flavor: 'standard' }))
      .toBe('https://github.com/RuslanSinkevich/gitbor/releases/download/v0.1.27/GitBor-0.1.27-arm64.dmg');
  });

  it('с бакетом — файл рядом с feed', () => {
    expect(resolveUpdateAssetUrl({ version: '0.1.27', fileName: 'GitBor-NoAI-0.1.27-arm64.dmg', platform: 'darwin', flavor: 'no-ai', baseUrl: 'https://b.example/stable/' }))
      .toBe('https://b.example/stable/mac/no_ai/GitBor-NoAI-0.1.27-arm64.dmg');
  });
});
