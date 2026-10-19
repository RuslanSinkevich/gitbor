import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { GitExecutor } from '@core/git/GitExecutor';
import { SafetyNet } from '@core/safety/SafetyNet';
import type { OperationQueue } from '@core/safety/OperationQueue';
import type { StateManager } from '@core/state/StateManager';
import { cherryPickContinue, cherryPickMany, cherryPickSkip } from '@core/commands/writeCommands';
import { ConflictManager } from '@core/commands/ConflictManager';
import { makeMockQueue, makeMockState } from '../_mocks';

vi.mock('@core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/** Серия cherry-pick с конфликтом посередине: баннер «применено N из M», «Продолжить», «Пропустить». */
let repo: string;
let picks: string[];
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const q = () => makeMockQueue() as unknown as OperationQueue;
const st = () => makeMockState() as unknown as StateManager;
const write = (f: string, s: string) => writeFileSync(join(repo, f), s);

beforeEach(() => {
  delete process.env.GIT_EDITOR;
  repo = mkdtempSync(join(tmpdir(), 'gitbor-cps-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  git('config', 'core.editor', 'vi');
  write('a.txt', 'base\n'); git('add', '.'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'task');
  write('x.txt', 'x\n'); git('add', '.'); git('commit', '-qm', 'p1');
  write('a.txt', 'task\n'); git('commit', '-qam', 'p2 conflicts');
  write('y.txt', 'y\n'); git('add', '.'); git('commit', '-qm', 'p3');
  picks = git('log', '--reverse', '--format=%H', 'main..task').trim().split('\n');
  git('checkout', '-q', 'main');
  write('a.txt', 'main\n'); git('commit', '-qam', 'main edit');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const subjects = () => git('log', '--format=%s', '-4').trim().split('\n').reverse();

describe('cherry-pick серия', () => {
  it('останавливается на конфликте, прогресс верный, «Продолжить» доводит серию', async () => {
    const ex = new GitExecutor(repo);
    const r = await cherryPickMany(q(), ex, new SafetyNet(ex), st(), picks);
    expect(r.success).toBe(false);
    const ms = await new ConflictManager(ex).getMergeState();
    expect(ms.kind).toBe('cherry-pick');
    // p1 применён, остановились на p2 — «применено 1 из 3».
    expect([ms.sequencerDone, ms.sequencerTotal]).toEqual([1, 3]);
    write('a.txt', 'resolved\n'); git('add', 'a.txt');
    const c = await cherryPickContinue(q(), ex, st());
    expect(c.success).toBe(true);
    expect((await new ConflictManager(ex).getMergeState()).inProgress).toBe(false);
    expect(subjects()).toEqual(['main edit', 'p1', 'p2 conflicts', 'p3']);
  });

  it('«Пропустить» выкидывает конфликтный коммит и применяет остальные', async () => {
    const ex = new GitExecutor(repo);
    await cherryPickMany(q(), ex, new SafetyNet(ex), st(), picks);
    const s = await cherryPickSkip(q(), ex, st());
    expect(s.success).toBe(true);
    expect((await new ConflictManager(ex).getMergeState()).inProgress).toBe(false);
    expect(git('log', '--format=%s', '-3').trim().split('\n').reverse()).toEqual(['main edit', 'p1', 'p3']);
  });

  it('«Отменить» возвращает ветку к состоянию до серии', async () => {
    const ex = new GitExecutor(repo);
    const before = git('rev-parse', 'HEAD').trim();
    await cherryPickMany(q(), ex, new SafetyNet(ex), st(), picks);
    await new ConflictManager(ex).abortMerge();
    expect(git('rev-parse', 'HEAD').trim()).toBe(before);
    expect(git('status', '--porcelain')).toBe('');
  });
});
