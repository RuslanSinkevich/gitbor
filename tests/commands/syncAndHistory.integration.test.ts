import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { GitExecutor } from '@core/git/GitExecutor';
import { SafetyNet } from '@core/safety/SafetyNet';
import type { OperationQueue } from '@core/safety/OperationQueue';
import type { StateManager } from '@core/state/StateManager';
import { createTag, deleteTag, fetch, pull, push, revert } from '@core/commands/writeCommands';
import { ConflictManager } from '@core/commands/ConflictManager';
import { RebaseManager } from '@core/git/RebaseManager';
import { makeMockQueue, makeMockState } from '../_mocks';

vi.mock('@core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/** push / pull / fetch / revert / метки — с настоящим «сервером» (bare-репозиторий). */
let remote: string, repo: string, other: string;
const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const git = (...args: string[]) => run(repo, ...args);
const q = () => makeMockQueue() as unknown as OperationQueue;
const st = () => makeMockState() as unknown as StateManager;
const cfg = (cwd: string) => {
  run(cwd, 'config', 'user.email', 't@t'); run(cwd, 'config', 'user.name', 't'); run(cwd, 'config', 'core.autocrlf', 'false');
};

beforeEach(() => {
  delete process.env.GIT_EDITOR;
  remote = mkdtempSync(join(tmpdir(), 'gitbor-srv-'));
  run(remote, 'init', '-q', '--bare', '-b', 'main');
  repo = mkdtempSync(join(tmpdir(), 'gitbor-me-'));
  git('init', '-q', '-b', 'main'); cfg(repo); git('config', 'core.editor', 'vi');
  writeFileSync(join(repo, 'a.txt'), 'base\n'); git('add', '.'); git('commit', '-qm', 'base');
  git('remote', 'add', 'origin', remote); git('push', '-q', '-u', 'origin', 'main');
  other = mkdtempSync(join(tmpdir(), 'gitbor-colleague-'));
  run(other, 'clone', '-q', remote, '.'); cfg(other);
});
afterEach(() => { for (const d of [remote, repo, other]) rmSync(d, { recursive: true, force: true }); });

const colleagueCommits = (content: string) => {
  writeFileSync(join(other, 'a.txt'), content); run(other, 'commit', '-qam', 'colleague'); run(other, 'push', '-q');
};

describe('sync', () => {
  it('fetch видит новые коммиты коллеги и чистит удалённые на сервере ветки', async () => {
    run(other, 'push', '-q', 'origin', 'HEAD:refs/heads/tmp');
    await fetch(q(), new GitExecutor(repo), st());
    run(other, 'push', '-q', 'origin', '--delete', 'tmp');
    colleagueCommits('colleague\n');
    const r = await fetch(q(), new GitExecutor(repo), st());
    expect(r.success).toBe(true);
    expect(git('rev-list', '--count', 'main..origin/main').trim()).toBe('1');
    expect(git('branch', '-r')).not.toMatch(/origin\/tmp/);
  });

  it('pull с локальными правками: правки на месте, подготовленное — подготовлено', async () => {
    colleagueCommits('colleague\n');
    writeFileSync(join(repo, 'b.txt'), 'mine\n'); git('add', 'b.txt');
    const ex = new GitExecutor(repo);
    const r = await pull(q(), ex, new SafetyNet(ex), st());
    expect(r.success).toBe(true);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('colleague\n');
    expect(git('status', '--porcelain')).toBe('A  b.txt\n');
  });

  it('pull --rebase с конфликтом → «Продолжить» без редактора', async () => {
    colleagueCommits('colleague\n');
    writeFileSync(join(repo, 'a.txt'), 'mine\n'); git('commit', '-qam', 'mine');
    const ex = new GitExecutor(repo);
    const r = await pull(q(), ex, new SafetyNet(ex), st(), true);
    expect(r.success).toBe(false);
    expect((await new ConflictManager(ex).getMergeState()).kind).toBe('rebase');
    writeFileSync(join(repo, 'a.txt'), 'both\n'); git('add', 'a.txt');
    const c = await new RebaseManager(ex).continueRebase();
    expect(c.success).toBe(true);
    expect(git('log', '--format=%s', '-2').trim().split('\n')).toEqual(['mine', 'colleague']);
  });

  it('push --force-with-lease не затирает чужой коммит, о котором мы не знаем', async () => {
    colleagueCommits('colleague\n');
    git('commit', '-q', '--allow-empty', '-m', 'mine');
    git('fetch', '-q'); git('reset', '-q', '--hard', 'HEAD~1');
    colleagueCommits('colleague 2\n');
    git('commit', '-q', '--allow-empty', '-m', 'rewritten');
    const r = await push(q(), new GitExecutor(repo), st(), true);
    expect(r.success).toBe(false);
    expect(run(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('colleague');
  });
});

describe('history', () => {
  it('revert с конфликтом → завершение создаёт коммит «Revert …»', async () => {
    writeFileSync(join(repo, 'a.txt'), 'v2\n'); git('commit', '-qam', 'v2');
    const v2 = git('rev-parse', 'HEAD').trim();
    writeFileSync(join(repo, 'a.txt'), 'v3\n'); git('commit', '-qam', 'v3');
    const ex = new GitExecutor(repo);
    const r = await revert(q(), ex, new SafetyNet(ex), st(), v2);
    expect(r.success).toBe(false);
    const cm = new ConflictManager(ex);
    expect((await cm.getMergeState()).kind).toBe('revert');
    writeFileSync(join(repo, 'a.txt'), 'v3 without v2\n'); git('add', 'a.txt');
    const c = await cm.completeMerge();
    expect(c.success).toBe(true);
    expect(git('log', '-1', '--format=%s').trim()).toBe('Revert "v2"');
  });

  it('метка: аннотированная создаётся с сообщением, удаление на сервере работает', async () => {
    const ex = new GitExecutor(repo);
    expect((await createTag(q(), ex, st(), 'v1.0', 'HEAD', 'release')).success).toBe(true);
    expect(git('tag', '-n1', '-l', 'v1.0')).toMatch(/release/);
    git('push', '-q', 'origin', 'v1.0');
    expect((await deleteTag(q(), ex, st(), 'v1.0', true)).success).toBe(true);
    expect(run(remote, 'tag', '-l')).toBe('');
  });
});
