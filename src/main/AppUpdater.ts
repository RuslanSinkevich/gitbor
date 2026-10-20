import { app, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mainLogger } from '../core/utils/Logger';
import { isNewerVersion } from '../core/utils/semver';
import type { MainEvent } from '../core/bridge/messages';
import { BUILD_FLAVOR } from '../core/buildFlags';
import {
  collectUpdateArtifactNames,
  decideUpdateAcceptance,
  pickMacDmg,
  resolveUpdateAssetUrl,
  resolveUpdateFeed,
  GITHUB_UPDATE_REPO,
  type UpdateArtifactInfo,
} from './updateFlavor';
import { parseReleaseNotes, type ReleaseNotes } from './releaseNotes';

const STARTUP_CHECK_DELAY_MS = 8_000;
const NOTES_FETCH_TIMEOUT_MS = 4_000;

/**
 * ЗАПАСНОЙ источник заметок — changelog сайта (`/api/v1/changelog?version=...`).
 * Основной — `releaseNotes` в latest.yml (см. ./releaseNotes). Сайт стал
 * лендингом и этот API сейчас отдаёт 404 — оставлено на случай его возврата.
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

/**
 * macOS не даёт программе заменить саму себя без подписи Apple Developer ID
 * (Squirrel.Mac проверяет подпись), а у нас ad-hoc подпись и только dmg.
 * Поэтому на Mac не качаем через electron-updater, а предлагаем скачать
 * установщик: GitBor кладёт dmg в «Загрузки» и открывает его.
 */
const isMac = (): boolean => process.platform === 'darwin';

type MacInstaller = { version: string; fileName: string; url: string; sha512?: string };
let macPending: MacInstaller | null = null;

function rememberMacInstaller(version: string, info: UpdateArtifactInfo): boolean {
  const fileName = pickMacDmg(info, process.arch);
  if (!fileName) {
    mainLogger.warn(`appUpdater: no dmg for ${process.arch} in ${version} (${collectUpdateArtifactNames(info).join(', ')})`);
    return false;
  }
  const url = resolveUpdateAssetUrl({
    version, fileName, platform: process.platform, flavor: BUILD_FLAVOR, baseUrl: process.env.GITBOR_UPDATE_BASE_URL,
  });
  const sha512 = info.files?.find((f) => f.url?.endsWith(fileName))?.sha512;
  macPending = { version, fileName, url, ...(sha512 ? { sha512 } : {}) };
  return true;
}

async function sha512Base64(file: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return hash.digest('base64');
}

/** Скачать dmg в «Загрузки», сверить sha512 из latest-mac.yml и открыть. */
async function installMacDmg(notify: (event: MainEvent) => void): Promise<void> {
  const p = macPending;
  if (!p) return;
  const releaseUrl = process.env.GITBOR_UPDATE_BASE_URL
    ? p.url
    : `https://github.com/${GITHUB_UPDATE_REPO.owner}/${GITHUB_UPDATE_REPO.repo}/releases/tag/v${p.version}`;
  const dest = join(app.getPath('downloads'), p.fileName);
  const part = `${dest}.part`;
  notify({ type: 'appUpdateMacInstaller', state: 'downloading', file: p.fileName });
  try {
    const res = await net.fetch(p.url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(part));
    if (p.sha512 && (await sha512Base64(part)) !== p.sha512) throw new Error('sha512 mismatch');
    await rename(part, dest);
    const openError = await shell.openPath(dest);
    if (openError) throw new Error(openError);
    notify({ type: 'appUpdateMacInstaller', state: 'opened', file: dest });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mainLogger.warn(`appUpdater: mac installer failed: ${msg}`);
    await rm(part, { force: true }).catch(() => {});
    notify({ type: 'appUpdateMacInstaller', state: 'error', error: msg, releaseUrl });
  }
}

function isPortableBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE);
}

/**
 * Feed задаём в рантайме, а не берём из app-update.yml: там зашит бакет.
 * По умолчанию — GitHub Releases, No-AI читает свой канал noai.yml, иначе
 * скачается чужой Setup (регрессия 0.1.17). GITBOR_UPDATE_BASE_URL включает
 * старый generic feed через бакет. Политика — resolveUpdateFeed (покрыта тестами).
 */
function configurePlatformFeedUrl(): void {
  autoUpdater.setFeedURL(
    resolveUpdateFeed({
      platform: process.platform,
      flavor: BUILD_FLAVOR,
      baseUrl: process.env.GITBOR_UPDATE_BASE_URL,
    }),
  );
}

/**
 * Auto-update через GitHub Releases (запасной путь — бакет, см. configurePlatformFeedUrl).
 * Поддержка: packaged Windows NSIS и Linux AppImage; на macOS — скачать и
 * открыть dmg (см. installMacDmg). Пропускаем dev,
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
  // на недоступный feed / битый latest.yml вылетает в main process.
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
    if (isMac()) {
      if (!rememberMacInstaller(info.version, info)) return;
      const notes = parseReleaseNotes(info.releaseNotes);
      notify({ type: 'appUpdateReady', version: info.version, macInstaller: true, ...(notes ? { notes } : {}) });
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
    // Заметки — из latest.yml релиза (build/release-notes.md при сборке).
    // Сайт — только запасной вариант для старых релизов без releaseNotes.
    const bundled = parseReleaseNotes(info.releaseNotes);
    const notesPromise = bundled ? Promise.resolve(bundled) : fetchReleaseNotes(info.version);
    void notesPromise.then((notes) => {
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

export function installDownloadedUpdate(notify: (event: MainEvent) => void): void {
  if (!app.isPackaged || isPortableBuild()) return;
  if (isMac()) {
    void installMacDmg(notify);
    return;
  }
  autoUpdater.quitAndInstall(true, true);
}

/** macOS: закрыть GitBor, чтобы Finder смог заменить его из установщика. */
export function quitForMacInstall(): void {
  if (isMac()) app.quit();
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
      notify({ type: 'appUpdateManualResult', result: 'available', version: remote, current, ...(isMac() ? { macInstaller: true } : {}) });
      return;
    }
    notify({ type: 'appUpdateManualResult', result: 'up-to-date', current });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mainLogger.warn(`appUpdater: manual check failed: ${msg}`);
    notify({ type: 'appUpdateManualResult', result: 'error', error: msg });
  }
}
