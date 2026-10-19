import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { GitExecutor } from '@core/git/GitExecutor';
import { SafetyNet } from '@core/safety/SafetyNet';
import type { OperationQueue } from '@core/safety/OperationQueue';
import type { StateManager } from '@core/state/StateManager';
import { checkout, deleteBranch, resetTo } from '@core/commands/writeCommands';
import { makeMockQueue, makeMockState } from '../_mocks';

vi.mock('@core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/**
 * То, что обещает UI, на настоящем git: «Hard удаляет незакоммиченное»,
 * «переключение возвращает изменения», «удалить и на сервере».
 */
let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const q = () => makeMockQueue() as unknown as OperationQueue;
const st = () => makeMockState() as unknown as StateManager;
const write = (f: string, s: string) => writeFileSync(join(repo, f), s);
const read = (f: string) => (existsSync(join(repo, f)) ? readFileSync(join(repo, f), 'utf8') : null);

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'gitbor-safety-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'core.autocrlf', 'false');
  write('a.txt', 'v1\n'); git('add', '.'); git('commit', '-qm', 'c1');
  write('a.txt', 'v2\n'); git('commit', '-qam', 'c2');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('reset', () => {
  it('hard: рабочая копия как в коммите, незакоммиченное — в auto-stash, а не обратно с конфликтом', async () => {
    const ex = new GitExecutor(repo);
    write('a.txt', 'local\n'); write('n.txt', 'new\n'); git('add', 'n.txt');
    const r = await resetTo(q(), ex, new SafetyNet(ex), st(), git('rev-parse', 'HEAD~1').trim(), 'hard');
    expect(r.success).toBe(true);
    expect(read('a.txt')).toBe('v1\n');
    expect(read('n.txt')).toBeNull();
    expect(git('status', '--porcelain')).toBe('');
    expect(git('stash', 'list')).toMatch(/GitBor auto-stash.*reset/);
  });

  it('soft: незакоммиченное остаётся на месте, stash не создаётся', async () => {
    const ex = new GitExecutor(repo);
    write('a.txt', 'local\n');
    const r = await resetTo(q(), ex, new SafetyNet(ex), st(), git('rev-parse', 'HEAD~1').trim(), 'soft');
    expect(r.success).toBe(true);
    expect(read('a.txt')).toBe('local\n');
    expect(git('stash', 'list')).toBe('');
  });
});

describe('checkout с auto-stash', () => {
  it('подготовленное остаётся подготовленным на новой ветке', async () => {
    const ex = new GitExecutor(repo);
    git('branch', 'other');
    write('a.txt', 'staged\n'); git('add', 'a.txt');
    const r = await checkout(q(), ex, new SafetyNet(ex), st(), 'other', 'stash');
    expect(r.success).toBe(true);
    expect(git('branch', '--show-current').trim()).toBe('other');
    expect(git('status', '--porcelain')).toBe('M  a.txt\n');
    expect(git('stash', 'list')).toBe('');
  });
});

describe('deleteBranch', () => {
  let remote: string;
  beforeEach(() => {
    remote = mkdtempSync(join(tmpdir(), 'gitbor-remote-'));
    execFileSync('git', ['init', '-q', '--bare'], { cwd: remote });
    git('remote', 'add', 'origin', remote);
    git('branch', 'TASK-1');
    git('push', '-q', '-u', 'origin', 'TASK-1');
  });
  afterEach(() => rmSync(remote, { recursive: true, force: true }));
  const remoteHas = (b: string) =>
    execFileSync('git', ['branch', '--list', b], { cwd: remote, encoding: 'utf8' }).trim() !== '';

  it('без галочки — только локальная', async () => {
    const r = await deleteBranch(q(), new GitExecutor(repo), st(), 'TASK-1', true);
    expect(r.success).toBe(true);
    expect(git('branch', '--list', 'TASK-1')).toBe('');
    expect(remoteHas('TASK-1')).toBe(true);
  });

  it('с галочкой — и на сервере', async () => {
    const r = await deleteBranch(q(), new GitExecutor(repo), st(), 'TASK-1', true, true);
    expect(r.success).toBe(true);
    expect(git('branch', '--list', 'TASK-1')).toBe('');
    expect(remoteHas('TASK-1')).toBe(false);
  });

  it('без upstream — понятная ошибка, локальная ветка цела', async () => {
    git('branch', 'local-only');
    const r = await deleteBranch(q(), new GitExecutor(repo), st(), 'local-only', true, true);
    expect(r.success).toBe(false);
    expect(git('branch', '--list', 'local-only')).not.toBe('');
  });
});
