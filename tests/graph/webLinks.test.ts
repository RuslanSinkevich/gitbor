import { describe, it, expect } from 'vitest';
import { toWebRepo, commitUrl, pullRequestUrl, parsePullRequestId } from '../../src/renderer/src/features/graph/webLinks';

describe('toWebRepo', () => {
  it('Azure on-prem TFS (https с коллекцией)', () => {
    const r = toWebRepo('https://tfs.sibgenco.local/tfs/SibgencoCollection/CRM/_git/ConsumerCRM-old-techpris');
    expect(r).toEqual({ host: 'azure', base: 'https://tfs.sibgenco.local/tfs/SibgencoCollection/CRM/_git/ConsumerCRM-old-techpris' });
  });

  it('Azure cloud https с логином в адресе', () => {
    const r = toWebRepo('https://org@dev.azure.com/org/Proj/_git/Repo');
    expect(r).toEqual({ host: 'azure', base: 'https://dev.azure.com/org/Proj/_git/Repo' });
  });

  it('Azure SSH', () => {
    const r = toWebRepo('git@ssh.dev.azure.com:v3/org/Proj/Repo');
    expect(r).toEqual({ host: 'azure', base: 'https://dev.azure.com/org/Proj/_git/Repo' });
  });

  it('GitHub SSH и https', () => {
    expect(toWebRepo('git@github.com:user/app.git')).toEqual({ host: 'github', base: 'https://github.com/user/app' });
    expect(toWebRepo('https://github.com/user/app.git')).toEqual({ host: 'github', base: 'https://github.com/user/app' });
  });

  it('GitLab self-hosted', () => {
    expect(toWebRepo('git@gitlab.company.ru:group/sub/app.git')).toEqual({ host: 'gitlab', base: 'https://gitlab.company.ru/group/sub/app' });
  });

  it('неизвестный хостинг или локальный путь — null', () => {
    expect(toWebRepo('D:/repos/app.git')).toBeNull();
    expect(toWebRepo('https://git.example.com/app.git')).toBeNull();
    expect(toWebRepo('')).toBeNull();
  });
});

describe('ссылки', () => {
  const az = { host: 'azure' as const, base: 'https://h/tfs/C/P/_git/R' };
  it('коммит и PR в Azure', () => {
    expect(commitUrl(az, 'abc')).toBe('https://h/tfs/C/P/_git/R/commit/abc');
    expect(pullRequestUrl(az, '12054')).toBe('https://h/tfs/C/P/_git/R/pullrequest/12054');
  });
  it('GitLab', () => {
    const gl = { host: 'gitlab' as const, base: 'https://gl/g/a' };
    expect(commitUrl(gl, 'abc')).toBe('https://gl/g/a/-/commit/abc');
    expect(pullRequestUrl(gl, '7')).toBe('https://gl/g/a/-/merge_requests/7');
  });
});

describe('parsePullRequestId', () => {
  it('Azure по-русски и по-английски', () => {
    expect(parsePullRequestId('Объединенный запрос на вытягивание 12054: feat(crm-server): фильтр')).toBe('12054');
    expect(parsePullRequestId('Merged PR 12054: feat: x')).toBe('12054');
  });
  it('GitHub и GitLab', () => {
    expect(parsePullRequestId('Merge pull request #123 from user/branch')).toBe('123');
    expect(parsePullRequestId('Merge branch x into y. See merge request group/app!45')).toBe('45');
  });
  it('обычный коммит — null', () => {
    expect(parsePullRequestId('fix(outgoing): буква нового ответа')).toBeNull();
    expect(parsePullRequestId("Merge branch 'develop' into feature/x")).toBeNull();
  });
});
