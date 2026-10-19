import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { GitExecutor } from '@core/git/GitExecutor';
import { ConflictManager, hasConflictMarkers } from '@core/commands/ConflictManager';

vi.mock('@core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/**
 * Конфликты на настоящем git: что выбрал человек — то и в индексе.
 * main меняет a.txt и удаляет d.txt; feature меняет оба.
 */
let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const write = (f: string, s: string) => writeFileSync(join(repo, f), s);
const read = (f: string) => (existsSync(join(repo, f)) ? readFileSync(join(repo, f), 'utf8') : null);
const status = () => git('status', '--porcelain');
const noFf = { noCommit: false, squash: false, ffOnly: false, noFf: false };

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'gitbor-conflicts-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'core.autocrlf', 'false');
  write('a.txt', 'base\n'); write('d.txt', 'base\n'); git('add', '.'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  write('a.txt', 'FEATURE\n'); write('d.txt', 'feature edit\n'); git('commit', '-qam', 'feature');
  git('checkout', '-q', 'main');
  write('a.txt', 'MAIN\n'); git('rm', '-q', 'd.txt'); git('commit', '-qam', 'main');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('merge conflict', () => {
  it('стороны: у нас d.txt удалён, у них изменён — панель так и показывает', async () => {
    const cm = new ConflictManager(new GitExecutor(repo));
    await cm.merge('feature', noFf);
    const ms = await cm.getMergeState();
    expect([ms.targetBranch, ms.sourceBranch]).toEqual(['main', 'feature']);
    expect(ms.conflictFiles.find(f => f.path === 'd.txt')).toMatchObject({ oursModified: false, theirsModified: true });
  });

  it('«Принять нашу» на удалённом у нас файле — файл удалён, а не взят их', async () => {
    const cm = new ConflictManager(new GitExecutor(repo));
    await cm.merge('feature', noFf);
    await cm.resolveWithOurs('d.txt');
    expect(read('d.txt')).toBeNull();
    expect(status()).not.toMatch(/d\.txt/);
  });

  it('«Принять их» на удалённом у нас файле — их версия в индексе', async () => {
    const cm = new ConflictManager(new GitExecutor(repo));
    await cm.merge('feature', noFf);
    await cm.resolveWithTheirs('d.txt');
    expect(read('d.txt')).toBe('feature edit\n');
    expect(status()).toMatch(/^A {2}d\.txt$/m);
  });

  it('«Пометить разрешённым» не пропускает маркеры конфликта в коммит', async () => {
    const cm = new ConflictManager(new GitExecutor(repo));
    await cm.merge('feature', noFf);
    await expect(cm.stageResolved('a.txt')).rejects.toThrow(/conflict markers/);
    expect(status()).toMatch(/^UU a\.txt$/m);
    write('a.txt', 'merged by hand\n');
    await cm.stageResolved('a.txt');
    expect(status()).toMatch(/^M {2}a\.txt$/m);
  });

  it('завершение слияния создаёт merge-коммит', async () => {
    const cm = new ConflictManager(new GitExecutor(repo));
    await cm.merge('feature', noFf);
    await cm.resolveWithOurs('a.txt');
    await cm.resolveWithOurs('d.txt');
    const r = await cm.completeMerge();
    expect(r.success).toBe(true);
    expect(git('log', '-1', '--format=%p').trim().split(' ')).toHaveLength(2);
  });

  it('отмена возвращает как было, новые файлы не трогает', async () => {
    const cm = new ConflictManager(new GitExecutor(repo));
    write('x.txt', 'untracked\n');
    await cm.merge('feature', noFf);
    await cm.abortMerge();
    expect(read('a.txt')).toBe('MAIN\n');
    expect(read('x.txt')).toBe('untracked\n');
    expect((await cm.getMergeState()).inProgress).toBe(false);
  });
});

describe('rebase conflict', () => {
  it('стороны подписаны как у git: ours — куда переносим, theirs — ваша ветка', async () => {
    git('checkout', '-q', 'feature');
    try { git('rebase', 'main'); } catch { /* конфликт ожидаем */ }
    const cm = new ConflictManager(new GitExecutor(repo));
    const ms = await cm.getMergeState();
    expect(ms.kind).toBe('rebase');
    expect([ms.targetBranch, ms.sourceBranch]).toEqual(['main', 'feature']);
    await cm.resolveWithOurs('a.txt');
    expect(read('a.txt')).toBe('MAIN\n');
  });
});

describe('hasConflictMarkers', () => {
  it('маркеры git — да; похожие строки в тексте — нет', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feature\n')).toBe(true);
    expect(hasConflictMarkers('Заголовок\n=======\nтекст <<<<<<< не в начале\n')).toBe(false);
  });
});
