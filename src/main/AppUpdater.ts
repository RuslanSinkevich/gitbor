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
 * electron-builder зашивает `publish.url` (`stable/win/`) в app-update.yml.
 * Но Linux/macOS-артефакты лежат в других папках бакета (`stable/linux/`,
 * `stable/mac/`), а electron-updater ищет `latest-linux.yml` /
 * `latest-mac.yml` относительно feed-URL. Без переопределения Linux искал
 * бы `stable/win/latest-linux.yml` и обновление не находилось бы.
 *
 * Поэтому feed-URL выставляем по платформе в рантайме. Для Windows значение
 * совпадает с app-update.yml — поведение не меняется. Linux auto-update
 * поддерживается только для AppImage (deb обновляется через apt).
 */
function configurePlatformFeedUrl(): void {
  const base =
    process.env.GITBOR_UPDATE_BASE_URL ??
    'https://storage.yandexcloud.net/gitbor/stable';
  const dir =
    process.platform === 'win32'
      ? 'win'
      : process.platform === 'darwin'
        ? 'mac'
        : 'linux';
  autoUpdater.setFeedURL({ provider: 'generic', url: `${base}/${dir}/` });
}

/**
 * Auto-update через Yandex Object Storage (generic provider).
 * Поддержка: packaged Windows NSIS и Linux AppImage. Пропускаем dev,
 * Windows-portable и deb (apt). Feed-URL — по платформе
 * (см. configurePlatformFeedUrl). UI — в renderer (i18n).
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
  autoUpdater.autoInstallOnAppQuit = false;
  configurePlatformFeedUrl();

  // `error` нужен: иначе unhandled rejection из недр electron-updater'а
  // на недоступный бакет / битый latest.yml вылетает в main process.
  autoUpdater.on('error', (err) => {
    mainLogger.warn(`appUpdater: ${err.message}`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (info.version === app.getVersion()) {
      mainLogger.debug(`appUpdater: downloaded same version ${info.version}, ignoring`);
      return;
    }
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
  autoUpdater.quitAndInstall(true, true);
}

/** Ручная проверка — результат в renderer через `appUpdateManualResult`. */
export async function runManualUpdateCheck(notify: (event: MainEvent) => void): Promise<void> {
  if (!app.isPackaged || isPortableBuild()) {
    notify({ type: 'appUpdateManualResult', result: 'nsis-only' });
    return;
  }

  configurePlatformFeedUrl();

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
