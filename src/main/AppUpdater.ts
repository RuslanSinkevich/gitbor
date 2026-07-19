import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { mainLogger } from '../core/utils/Logger';
import { isNewerVersion } from '../core/utils/semver';
import type { MainEvent } from '../core/bridge/messages';
import { BUILD_FLAVOR } from '../core/buildFlags';
import {
  collectUpdateArtifactNames,
  decideUpdateAcceptance,
  resolveUpdateFeedUrl,
} from './updateFlavor';

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
 * electron-builder зашивает publish.url в app-update.yml; на Linux/macOS
 * без рантайм-override updater искал бы не тот latest-*.yml. No-AI — всегда
 * каталог no_ai (win/no_ai и т.п.), иначе скачается чужой Setup (регрессия 0.1.17).
 * Политика URL — resolveUpdateFeedUrl (покрыта тестами).
 */
function configurePlatformFeedUrl(): void {
  const url = resolveUpdateFeedUrl({
    platform: process.platform,
    flavor: BUILD_FLAVOR,
    baseUrl: process.env.GITBOR_UPDATE_BASE_URL,
  });
  autoUpdater.setFeedURL({ provider: 'generic', url });
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
  // Скачиваем сами после проверки flavor — иначе autoDownload может
  // начать тянуть чужой Setup до того, как мы успеем отказаться.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  configurePlatformFeedUrl();

  // `error` нужен: иначе unhandled rejection из недр electron-updater'а
  // на недоступный бакет / битый latest.yml вылетает в main process.
  autoUpdater.on('error', (err) => {
    mainLogger.warn(`appUpdater: ${err.message}`);
  });

  autoUpdater.on('update-available', (info) => {
    const decision = decideUpdateAcceptance({
      remoteVersion: info.version,
      currentVersion: app.getVersion(),
      flavor: BUILD_FLAVOR,
      info,
    });
    if (!decision.ok) {
      if (decision.reason === 'flavor-mismatch') {
        mainLogger.warn(
          `appUpdater: refusing update ${info.version} — artifact flavor mismatch for ${BUILD_FLAVOR} (${collectUpdateArtifactNames(info).join(', ') || 'no files'})`,
        );
      } else {
        mainLogger.debug(
          `appUpdater: available ${info.version} skipped (${decision.reason}) vs ${app.getVersion()}`,
        );
      }
      return;
    }
    void autoUpdater.downloadUpdate().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      mainLogger.warn(`appUpdater: download failed: ${msg}`);
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const decision = decideUpdateAcceptance({
      remoteVersion: info.version,
      currentVersion: app.getVersion(),
      flavor: BUILD_FLAVOR,
      info,
    });
    if (!decision.ok) {
      if (decision.reason === 'flavor-mismatch') {
        mainLogger.warn(
          `appUpdater: refusing install of ${info.version} — artifact flavor mismatch for ${BUILD_FLAVOR} (${collectUpdateArtifactNames(info).join(', ') || 'no files'})`,
        );
      } else {
        mainLogger.debug(
          `appUpdater: downloaded ${info.version} skipped (${decision.reason}) vs ${app.getVersion()}`,
        );
      }
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
      const updateInfo = result?.updateInfo ?? { path: undefined, files: [] };
      const decision = decideUpdateAcceptance({
        remoteVersion: remote,
        currentVersion: current,
        flavor: BUILD_FLAVOR,
        info: updateInfo,
      });
      if (!decision.ok) {
        mainLogger.warn(
          `appUpdater: manual check found ${remote}, but rejected (${decision.reason}) for ${BUILD_FLAVOR}`,
        );
        notify({
          type: 'appUpdateManualResult',
          result: 'error',
          error:
            decision.reason === 'flavor-mismatch'
              ? 'update flavor mismatch'
              : `update rejected: ${decision.reason}`,
        });
        return;
      }
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
