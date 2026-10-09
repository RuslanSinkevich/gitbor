/**
 * Ссылки на веб-интерфейс хостинга по адресу remote: страница коммита и
 * pull request'а. Поддержаны Azure DevOps (облако и on-prem TFS), GitHub,
 * GitLab; для прочих — null (пункт меню не показываем).
 */
export type WebHost = 'azure' | 'github' | 'gitlab';

export interface WebRepo {
  host: WebHost;
  /** Базовый https-адрес репозитория без `.git` и завершающего `/`. */
  base: string;
}

export function toWebRepo(remoteUrl: string | undefined | null): WebRepo | null {
  if (!remoteUrl) return null;
  const url = remoteUrl.trim();

  // Azure SSH: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const azSsh = /^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  if (azSsh) {
    return { host: 'azure', base: `https://dev.azure.com/${azSsh[1]}/${azSsh[2]}/_git/${azSsh[3]}` };
  }
  // Старый visualstudio.com по SSH: {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}
  const vsSsh = /vs-ssh\.visualstudio\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  if (vsSsh) {
    return { host: 'azure', base: `https://dev.azure.com/${vsSsh[1]}/${vsSsh[2]}/_git/${vsSsh[3]}` };
  }

  // SSH вида git@host:owner/repo(.git) → https://host/owner/repo
  const scp = /^[^@\s]+@([^:\s]+):(.+?)(?:\.git)?\/?$/.exec(url);
  const https = /^(https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url);
  let hostName: string;
  let path: string;
  let scheme = 'https';
  if (https) {
    scheme = https[1].toLowerCase();
    hostName = https[2];
    path = https[3];
  } else if (scp) {
    hostName = scp[1];
    path = scp[2];
  } else {
    return null;
  }
  const base = `${scheme}://${hostName}/${path}`;

  // Azure DevOps: облако (dev.azure.com, *.visualstudio.com) и on-prem
  // TFS/Azure DevOps Server — у всех путь содержит `/_git/`.
  if (/\/_git\//.test(path)) return { host: 'azure', base };
  if (/(^|\.)github\.com$/i.test(hostName)) return { host: 'github', base };
  if (/gitlab/i.test(hostName)) return { host: 'gitlab', base };
  return null;
}

export function commitUrl(repo: WebRepo, hash: string): string {
  switch (repo.host) {
    case 'azure': return `${repo.base}/commit/${hash}`;
    case 'github': return `${repo.base}/commit/${hash}`;
    case 'gitlab': return `${repo.base}/-/commit/${hash}`;
  }
}

export function pullRequestUrl(repo: WebRepo, id: string): string {
  switch (repo.host) {
    case 'azure': return `${repo.base}/pullrequest/${id}`;
    case 'github': return `${repo.base}/pull/${id}`;
    case 'gitlab': return `${repo.base}/-/merge_requests/${id}`;
  }
}

/**
 * Номер PR из сообщения merge-коммита:
 *  - Azure: «Merged PR 12054: …», «Объединенный запрос на вытягивание 12054: …»;
 *  - GitHub: «Merge pull request #123 from …»;
 *  - GitLab: «See merge request group/project!123».
 */
export function parsePullRequestId(subject: string): string | null {
  const patterns = [
    /^Merged PR (\d+)\b/i,
    /^Объедин[её]нный запрос на вытягивание (\d+)\b/i,
    /^Merge pull request #(\d+)\b/i,
    /merge request [^\s!]*!(\d+)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(subject);
    if (m) return m[1];
  }
  return null;
}
