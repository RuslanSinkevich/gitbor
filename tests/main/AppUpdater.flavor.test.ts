import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Интеграция setupAppUpdater / runManualUpdateCheck:
 * No-AI не должен download'ить AI Setup, даже если checkForUpdates
 * вернул «новую» версию с чужого feed (регрессия 0.1.17).
 */

const handlers = new Map<string, (...args: unknown[]) => void>();

const autoUpdaterMock = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  logger: null as unknown,
  setFeedURL: vi.fn(),
  downloadUpdate: vi.fn(() => Promise.resolve()),
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    handlers.set(event, handler);
    return autoUpdaterMock;
  }),
};

const appMock = {
  isPackaged: true,
  getVersion: vi.fn(() => '0.1.17'),
};

vi.mock('electron', () => ({
  app: appMock,
}));

vi.mock('electron-updater', () => ({
  autoUpdater: autoUpdaterMock,
}));

vi.mock('../../src/core/buildFlags', () => ({
  BUILD_FLAVOR: 'no-ai',
  AI_ENABLED: false,
  PRODUCT_NAME: 'GitBor No AI',
}));

vi.mock('../../src/core/utils/Logger', () => ({
  mainLogger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Импорт после моков
const { setupAppUpdater, runManualUpdateCheck } = await import('../../src/main/AppUpdater');
const { resolveUpdateFeedUrl, GITHUB_UPDATE_REPO } = await import('../../src/main/updateFlavor');

const AI_SETUP = {
  version: '0.1.19',
  path: 'GitBor-Setup-0.1.19.exe',
  files: [{ url: 'GitBor-Setup-0.1.19.exe' }],
  releaseDate: '2026-07-11',
  sha512: 'x',
};

const NOAI_SETUP = {
  version: '0.1.19',
  path: 'GitBor-NoAI-Setup-0.1.19.exe',
  files: [{ url: 'GitBor-NoAI-Setup-0.1.19.exe' }],
  releaseDate: '2026-07-11',
  sha512: 'x',
};

describe('AppUpdater flavor gates (no-ai build)', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    appMock.isPackaged = true;
    appMock.getVersion.mockReturnValue('0.1.17');
    delete process.env.GITBOR_SKIP_UPDATE_CHECK;
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    delete process.env.PORTABLE_EXECUTABLE_FILE;
    autoUpdaterMock.autoDownload = true;
    autoUpdaterMock.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: NOAI_SETUP,
      downloadPromise: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('по умолчанию feed — GitHub Releases, канал noai, autoDownload=false', () => {
    vi.useFakeTimers();
    setupAppUpdater(() => {});
    expect(autoUpdaterMock.autoDownload).toBe(false);
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
      provider: 'github',
      ...GITHUB_UPDATE_REPO,
      channel: 'noai',
    });
    // стартовый check через таймер — не сейчас
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
  });

  it('GITBOR_UPDATE_BASE_URL → запасной generic feed на платформенный */no_ai', () => {
    vi.useFakeTimers();
    const prev = process.env.GITBOR_UPDATE_BASE_URL;
    process.env.GITBOR_UPDATE_BASE_URL = 'https://example.test/stable';
    try {
      setupAppUpdater(() => {});
      // Не хардкодить win/: на Linux CI/VM feed — linux/no_ai (регрессия сборки в VM).
      expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith({
        provider: 'generic',
        url: resolveUpdateFeedUrl({
          platform: process.platform,
          flavor: 'no-ai',
          baseUrl: 'https://example.test/stable',
        }),
      });
    } finally {
      if (prev === undefined) delete process.env.GITBOR_UPDATE_BASE_URL;
      else process.env.GITBOR_UPDATE_BASE_URL = prev;
    }
  });

  it('REGRESSION: update-available с AI Setup → НЕ downloadUpdate', () => {
    vi.useFakeTimers();
    setupAppUpdater(() => {});
    const onAvailable = handlers.get('update-available');
    expect(onAvailable).toBeTypeOf('function');
    onAvailable?.(AI_SETUP);
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
  });

  it('update-available с NoAI Setup → downloadUpdate', () => {
    vi.useFakeTimers();
    setupAppUpdater(() => {});
    handlers.get('update-available')?.(NOAI_SETUP);
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('REGRESSION: update-downloaded с AI Setup → НЕ appUpdateReady', async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    setupAppUpdater(notify);
    handlers.get('update-downloaded')?.({
      ...AI_SETUP,
      downloadedFile: `C:\\cache\\${AI_SETUP.path}`,
    });
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });

  it('update-downloaded с NoAI Setup → appUpdateReady', async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    // changelog fetch — fail closed без notes
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    setupAppUpdater(notify);
    handlers.get('update-downloaded')?.({
      ...NOAI_SETUP,
      downloadedFile: `C:\\cache\\${NOAI_SETUP.path}`,
    });
    // fetchReleaseNotes then notify
    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'appUpdateReady', version: '0.1.19' }),
      );
    });
    vi.unstubAllGlobals();
  });

  it('manual check: AI artifact → error flavor mismatch, не available', async () => {
    autoUpdaterMock.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: AI_SETUP,
      downloadPromise: null,
    });
    const notify = vi.fn();
    await runManualUpdateCheck(notify);
    expect(notify).toHaveBeenCalledWith({
      type: 'appUpdateManualResult',
      result: 'error',
      error: 'update flavor mismatch',
    });
  });

  it('manual check: NoAI artifact → available', async () => {
    autoUpdaterMock.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: NOAI_SETUP,
      downloadPromise: null,
    });
    const notify = vi.fn();
    await runManualUpdateCheck(notify);
    expect(notify).toHaveBeenCalledWith({
      type: 'appUpdateManualResult',
      result: 'available',
      version: '0.1.19',
      current: '0.1.17',
    });
  });
});
