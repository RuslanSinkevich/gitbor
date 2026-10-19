import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { GitExecutor } from '@core/git/GitExecutor';
import { RebaseManager } from '@core/git/RebaseManager';
import type { RebaseTodoEntry } from '@core/git/types';

vi.mock('@core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/**
 * Rebase без терминала, как у пользователя GitBor: GIT_EDITOR не задан,
 * git по умолчанию открыл бы vim. reword/squash/«Продолжить» не должны
 * ни падать, ни ждать редактор.
 */
let repo: string;
const savedEditor = { GIT_EDITOR: process.env.GIT_EDITOR, EDITOR: process.env.EDITOR, VISUAL: process.env.VISUAL };
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_EDITOR: 'true' } });
const write = (f: string, s: string) => writeFileSync(join(repo, f), s);
const subjects = () => git('log', '--format=%s', 'main..HEAD').trim().split('\n').reverse();

beforeEach(() => {
  delete process.env.GIT_EDITOR; delete process.env.EDITOR; delete process.env.VISUAL;
  repo = mkdtempSync(join(tmpdir(), 'gitbor-rebase-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'core.autocrlf', 'false');
  // Как у Git for Windows по умолчанию: без настроенного редактора — vi.
  git('config', 'core.editor', 'vi');
  write('a.txt', 'base\n'); git('add', '.'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  for (const n of ['one', 'two', 'three']) { write(`${n}.txt`, `${n}\n`); git('add', '.'); git('commit', '-qm', n, '-m', `body of ${n}`); }
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEditor)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const todo = async (rm: RebaseManager) => (await rm.getTodoList('main')).entries;

describe('interactive rebase без редактора', () => {
  it('reword: новый заголовок, тело сообщения сохраняется', async () => {
    const rm = new RebaseManager(new GitExecutor(repo));
    const entries = await todo(rm);
    entries[1] = { ...entries[1], action: 'reword', newSubject: 'two — переименован' };
    const r = await rm.executeRebase('main', entries);
    expect(r.success).toBe(true);
    expect(subjects()).toEqual(['one', 'two — переименован', 'three']);
    expect(git('log', '-1', '--format=%b', 'HEAD~1').trim()).toBe('body of two');
  });

  it('squash: коммиты объединяются, rebase не ждёт редактор', async () => {
    const rm = new RebaseManager(new GitExecutor(repo));
    const entries = await todo(rm);
    entries[1] = { ...entries[1], action: 'squash' };
    const r = await rm.executeRebase('main', entries);
    expect(r.success).toBe(true);
    expect(subjects()).toEqual(['one', 'three']);
  });

  it('edit → «Продолжить» доводит следующий reword', async () => {
    const rm = new RebaseManager(new GitExecutor(repo));
    const entries: RebaseTodoEntry[] = await todo(rm);
    entries[0] = { ...entries[0], action: 'edit' };
    entries[2] = { ...entries[2], action: 'reword', newSubject: 'three — новый' };
    await rm.executeRebase('main', entries);
    expect((await rm.getProgress()).inProgress).toBe(true);
    const c = await rm.continueRebase();
    expect(c.success).toBe(true);
    expect((await rm.getProgress()).inProgress).toBe(false);
    expect(subjects()).toEqual(['one', 'two', 'three — новый']);
    expect(existsSync(join(repo, '.git', 'gitbor-rebase'))).toBe(false);
  });
});

describe('«Продолжить» после конфликта', () => {
  it('сообщение коммита сохраняется, редактор не нужен', async () => {
    git('checkout', '-q', 'main');
    write('one.txt', 'main version\n'); git('add', '.'); git('commit', '-qm', 'main one');
    git('checkout', '-q', 'feature');
    const rm = new RebaseManager(new GitExecutor(repo));
    const r = await rm.executeRebase('main', await todo(rm));
    expect(r.success).toBe(false);
    write('one.txt', 'resolved\n'); git('add', 'one.txt');
    const c = await rm.continueRebase();
    expect(c.success).toBe(true);
    expect(subjects()).toEqual(['one', 'two', 'three']);
  });
});
