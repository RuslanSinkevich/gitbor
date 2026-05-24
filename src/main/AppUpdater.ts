import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { mainLogger } from '../core/utils/Logger';
import type { MainEvent } from '../core/bridge/messages';

const STARTUP_CHECK_DELAY_MS = 8_000;

export type AppUpdateManualResult = Extract<
  MainEvent,
  { type: 'appUpdateManualResult' }
>['result'];

function isPortableBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE);
}

/**
 * Auto-update через Yandex Object Storage (generic provider в build.publish).
 * Только packaged NSIS; dev и portable — пропускаем.
 * UI — в renderer (i18n).
 */
export function setupAppUpdater(notify: (event: MainEvent) => void): void {
  if (!app.isPackaged) {
    mainLogger.debug('appUpdater: skipped (dev / unpackaged)');
    return;
  }
  if (isPortableBuild()) {
    mainLogger.debug('appUpdater: skipped (portable build)');
    return;
  }
  if (process.env.GITBOR_SKIP_UPDATE_CHECK === '1') {
    mainLogger.debug('appUpdater: skipped (GITBOR_SKIP_UPDATE_CHECK=1)');
    return;
  }

  autoUpdater.logger = mainLogger;
  autoUpdater.autoDownload = true;

  autoUpdater.on('error', (err) => {
    mainLogger.warn(`appUpdater: ${err.message}`);
  });

  autoUpdater.on('update-available', (info) => {
    mainLogger.info(`appUpdater: update available ${info.version}`);
  });

  autoUpdater.on('update-not-available', () => {
    mainLogger.debug('appUpdater: up to date');
  });

  autoUpdater.on('update-downloaded', (info) => {
    notify({ type: 'appUpdateReady', version: info.version });
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      mainLogger.warn(`appUpdater: check failed: ${msg}`);
    });
  }, STARTUP_CHECK_DELAY_MS);
}

export function installDownloadedUpdate(): void {
  if (!app.isPackaged || isPortableBuild()) return;
  autoUpdater.quitAndInstall(false, true);
}

/** Ручная проверка — результат в renderer через `appUpdateManualResult`. */
export async function runManualUpdateCheck(notify: (event: MainEvent) => void): Promise<void> {
  if (!app.isPackaged || isPortableBuild()) {
    notify({ type: 'appUpdateManualResult', result: 'nsis-only' });
    return;
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    const remote = result?.updateInfo?.version;
    const current = app.getVersion();
    if (remote && remote !== current) {
      notify({ type: 'appUpdateManualResult', result: 'available', version: remote, current });
      return;
    }
    notify({ type: 'appUpdateManualResult', result: 'up-to-date', current });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mainLogger.warn(`appUpdater: manual check failed: ${msg}`);
    notify({ type: 'appUpdateManualResult', result: 'error', error: msg });
  }
}
