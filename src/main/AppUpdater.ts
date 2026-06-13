import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { mainLogger } from '../core/utils/Logger';
import { isNewerVersion } from '../core/utils/semver';
import type { MainEvent } from '../core/bridge/messages';
import { BUILD_FLAVOR } from '../core/buildFlags';

const STARTUP_CHECK_DELAY_MS = 8_000;
const NOTES_FETCH_TIMEOUT_MS = 4_000;

type ReleaseNotes = { ru: string[]; en: string[] };

/**
 * Краткие заметки «что нового» из changelog сайта. Источник истины — сайт
 * (`/api/v1/changelog?version=...`), оттуда же питается страница changelog.
 * Тянем в main, т.к. renderer заблокирован CSP. Best-effort: при любой ошибке
 * возвращаем undefined — модалка покажется без списка.
 */
async function fetchReleaseNotes(version: string): Promise<ReleaseNotes | undefined> {
  const base = process.env.GITBOR_WEB_BASE_URL ?? 'https://gitbor.ru';
  const url = `${base}/api/v1/changelog?version=${encodeURIComponent(version)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOTES_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return undefined;
    const data: unknown = await res.json();
    const release = (data as { release?: unknown } | null)?.release;
    if (!release || typeof release !== 'object') return undefined;
    const notes = (release as { notes?: unknown }).notes;
    if (!notes || typeof notes !== 'object') return undefined;
    const pick = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const ru = pick((notes as Record<string, unknown>).ru);
    const en = pick((notes as Record<string, unknown>).en);
    if (ru.length === 0 && en.length === 0) return undefined;
    return { ru, en };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

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
      ? (BUILD_FLAVOR as string) === 'no-ai'
        ? 'win/no_ai'
        : 'win'
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
    if (!isNewerVersion(info.version, app.getVersion())) {
      mainLogger.debug(`appUpdater: downloaded ${info.version} is not newer than ${app.getVersion()}, ignoring`);
      return;
    }
    void fetchReleaseNotes(info.version).then((notes) => {
      notify({ type: 'appUpdateReady', version: info.version, ...(notes ? { notes } : {}) });
    });
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
    // Только строго более новая версия считается доступной. Бакет может
    // временно отдавать latest.yml с откатом/старой версией — тогда показывать
    // «доступно обновление» нельзя (иначе у юзера с 0.1.17 «обновление» 0.1.16).
    if (remote && isNewerVersion(remote, current)) {
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
