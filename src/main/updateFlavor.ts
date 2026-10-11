/**
 * Политика auto-update по BUILD_FLAVOR: feed URL + проверка артефакта.
 * Чистые функции без electron — чтобы регрессия «No-AI скачал AI Setup»
 * ловилась тестами, а не пользователями.
 */

import { isNewerVersion } from '../core/utils/semver';

export type UpdateArtifactInfo = {
  path?: string;
  downloadedFile?: string;
  files?: Array<{ url?: string }>;
};

export type UpdateAcceptDecision =
  | { ok: true }
  | { ok: false; reason: 'not-newer' | 'flavor-mismatch' | 'no-artifacts' };

const DEFAULT_UPDATE_BASE = 'https://storage.yandexcloud.net/gitbor/stable';

/** Имена файлов из UpdateInfo / UpdateDownloadedEvent. */
export function collectUpdateArtifactNames(info: UpdateArtifactInfo): string[] {
  const names: string[] = [];
  if (info.path) names.push(info.path);
  if (info.downloadedFile) names.push(info.downloadedFile);
  for (const f of info.files ?? []) {
    if (f?.url) names.push(f.url);
  }
  return names;
}

/** No-AI артефакты именуются `*-NoAI-*` (см. dist:*:no-ai artifactName). */
export function isNoAiArtifactName(name: string): boolean {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  return /NoAI/i.test(base);
}

/**
 * Защита от кросс-flavor: No-AI не ставит GitBor-Setup, standard — не NoAI-Setup.
 * При пустых именах отказываем (лучше пропустить апдейт, чем поставить чужой билд).
 */
export function isUpdateArtifactMatchingFlavor(
  info: UpdateArtifactInfo,
  flavor: string,
): boolean {
  const names = collectUpdateArtifactNames(info);
  if (names.length === 0) return false;
  const wantNoAi = flavor === 'no-ai';
  return names.every((n) => isNoAiArtifactName(n) === wantNoAi);
}

/**
 * Каталог feed относительно stable/.
 * No-AI обязан ходить в каталог no_ai (win/no_ai и т.п.), иначе клиент
 * увидит чужой latest.yml (как No-AI 0.1.17: win/ → GitBor-Setup).
 */
export function resolveUpdateFeedDir(platform: string, flavor: string): string {
  const noAi = flavor === 'no-ai';
  if (platform === 'win32') return noAi ? 'win/no_ai' : 'win';
  if (platform === 'darwin') return noAi ? 'mac/no_ai' : 'mac';
  return noAi ? 'linux/no_ai' : 'linux';
}

/** Репозиторий, в Releases которого CI (release.yml) выкладывает сборки. */
export const GITHUB_UPDATE_REPO = { owner: 'RuslanSinkevich', repo: 'gitbor' } as const;

/**
 * Канал на GitHub Releases: обе flavor лежат в одном релизе, поэтому
 * No-AI читает свой noai.yml (noai-linux.yml / noai-mac.yml), standard —
 * latest.yml. Имена задаются при сборке через publish.channel.
 */
export function resolveUpdateChannel(flavor: string): 'latest' | 'noai' {
  return flavor === 'no-ai' ? 'noai' : 'latest';
}

export type UpdateFeed =
  | { provider: 'github'; owner: string; repo: string; channel: string }
  | { provider: 'generic'; url: string };

/**
 * Источник обновлений: по умолчанию GitHub Releases. GITBOR_UPDATE_BASE_URL
 * (baseUrl) возвращает старый generic feed — запасной путь через бакет.
 */
export function resolveUpdateFeed(opts: {
  platform: string;
  flavor: string;
  baseUrl?: string;
}): UpdateFeed {
  if (opts.baseUrl) {
    return { provider: 'generic', url: resolveUpdateFeedUrl(opts) };
  }
  return { provider: 'github', ...GITHUB_UPDATE_REPO, channel: resolveUpdateChannel(opts.flavor) };
}

/** Полный generic feed URL для electron-updater.setFeedURL. */
export function resolveUpdateFeedUrl(opts: {
  platform: string;
  flavor: string;
  baseUrl?: string;
}): string {
  const raw = opts.baseUrl ?? DEFAULT_UPDATE_BASE;
  const base = raw.replace(/\/+$/, '');
  return `${base}/${resolveUpdateFeedDir(opts.platform, opts.flavor)}/`;
}

/**
 * Единая политика: скачивать / предлагать install только если версия новее
 * И артефакт совпадает с flavor. Используется и на update-available,
 * и на update-downloaded, и в manual check.
 */
export function decideUpdateAcceptance(opts: {
  remoteVersion: string;
  currentVersion: string;
  flavor: string;
  info: UpdateArtifactInfo;
}): UpdateAcceptDecision {
  if (!isNewerVersion(opts.remoteVersion, opts.currentVersion)) {
    return { ok: false, reason: 'not-newer' };
  }
  const names = collectUpdateArtifactNames(opts.info);
  if (names.length === 0) {
    return { ok: false, reason: 'no-artifacts' };
  }
  if (!isUpdateArtifactMatchingFlavor(opts.info, opts.flavor)) {
    return { ok: false, reason: 'flavor-mismatch' };
  }
  return { ok: true };
}
