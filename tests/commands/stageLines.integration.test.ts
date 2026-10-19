import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { GitExecutor } from '@core/git/GitExecutor';
import type { OperationQueue } from '@core/safety/OperationQueue';
import type { StateManager } from '@core/state/StateManager';
import { stageLines, stageHunk } from '@core/commands/writeCommands';
import { makeMockQueue, makeMockState } from '../_mocks';

vi.mock('@core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/**
 * Построчный stage/unstage на настоящем git: невыбранные строки ханка должны
 * оставаться как есть в обе стороны (для unstage патч идёт с `--reverse`).
 */
let repo: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'gitbor-lines-'));
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'f.txt'), 'a\nb\nc\nd\n');
  git('add', '.');
  git('commit', '-qm', 'init');
});

afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

const queue = () => makeMockQueue() as unknown as OperationQueue;
const state = () => makeMockState() as unknown as StateManager;

describe('stageLines (real git)', () => {
  it('stage: только выбранное добавление', async () => {
    // b удалена, X и Y добавлены — один ханк.
    writeFileSync(join(repo, 'f.txt'), 'a\nX\nc\nY\nd\n');
    const ex = new GitExecutor(repo);
    // Индексы строк в ханке: смотрим diff, ищем «+X».
    const r = await stageLines(queue(), ex, state(), 'f.txt', 0, [indexOf(repo, false, '+X')], false);
    expect(r.success).toBe(true);
    // Удаление b не выбрано — b остаётся, X встаёт после неё.
    expect(git('show', ':f.txt')).toBe('a\nb\nX\nc\nd\n');
  });

  it('unstage: снимаем только выбранное добавление, остальное остаётся в индексе', async () => {
    writeFileSync(join(repo, 'f.txt'), 'a\nX\nc\nY\nd\n');
    git('add', 'f.txt');
    const ex = new GitExecutor(repo);
    const r = await stageLines(queue(), ex, state(), 'f.txt', 0, [indexOf(repo, true, '+Y')], true);
    expect(r.success).toBe(true);
    // Y снят, удаление b и добавление X остались в индексе.
    expect(git('show', ':f.txt')).toBe('a\nX\nc\nd\n');
  });

  it('stageHunk: файл без перевода строки в конце', async () => {
    writeFileSync(join(repo, 'g.txt'), 'one\ntwo');
    git('add', '.');
    git('commit', '-qm', 'g');
    writeFileSync(join(repo, 'g.txt'), 'one\nTWO');
    const ex = new GitExecutor(repo);
    const r = await stageHunk(queue(), ex, state(), 'g.txt', 0, false);
    expect(r.success).toBe(true);
    expect(git('show', ':g.txt')).toBe('one\nTWO');
  });

  it('stageHunk: новый (untracked) файл целиком попадает в индекс', async () => {
    writeFileSync(join(repo, 'new.ts'), 'export interface A {\n  id: number;\n}\n');
    const ex = new GitExecutor(repo);
    const r = await stageHunk(queue(), ex, state(), 'new.ts', 0, false);
    expect(r.success).toBe(true);
    expect(git('status', '--short', '--', 'new.ts')).toBe('A  new.ts\n');
  });

  it('stageLines: новый файл — только выбранные строки, остальное остаётся в рабочей копии', async () => {
    writeFileSync(join(repo, 'new.ts'), 'one\ntwo\nthree\n');
    const ex = new GitExecutor(repo);
    // Ханк нового файла: +one, +two, +three — берём первые две строки.
    const r = await stageLines(queue(), ex, state(), 'new.ts', 0, [0, 1], false);
    expect(r.success).toBe(true);
    expect(git('show', ':new.ts')).toBe('one\ntwo\n');
    expect(git('status', '--short', '--', 'new.ts')).toBe('AM new.ts\n');
  });

  it('новый файл: при ошибке пометка снимается и файл остаётся untracked', async () => {
    writeFileSync(join(repo, 'new.ts'), 'one\n');
    const ex = new GitExecutor(repo);
    const r = await stageHunk(queue(), ex, state(), 'new.ts', 5, false);
    expect(r.success).toBe(false);
    expect(git('status', '--short', '--', 'new.ts')).toBe('?? new.ts\n');
  });
});

/** Индекс строки в первом ханке diff'а (без заголовков), как его видит UI. */
function indexOf(cwd: string, cached: boolean, needle: string): number {
  const out = execFileSync('git', ['diff', ...(cached ? ['--cached'] : []), '--', 'f.txt'], { cwd, encoding: 'utf8' });
  const lines = out.split('\n');
  const start = lines.findIndex(l => l.startsWith('@@'));
  const body = lines.slice(start + 1).filter(l => l !== '');
  const i = body.indexOf(needle);
  if (i < 0) throw new Error(`no ${needle} in diff`);
  return i;
}
