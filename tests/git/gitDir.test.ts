import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { resolveGitDir, resolveCommonGitDir } from '@core/git/gitDir';

let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'gitbor-gitdir-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('resolveGitDir', () => {
  it('обычный репо: <repo>/.git', () => {
    const repo = join(root, 'plain');
    mkdirSync(join(repo, '.git'), { recursive: true });
    expect(resolveGitDir(repo)).toBe(join(repo, '.git'));
    expect(resolveCommonGitDir(repo)).toBe(join(repo, '.git'));
  });

  it('worktree: .git-файл с относительным gitdir и commondir', () => {
    const main = join(root, 'main');
    const wtGitDir = join(main, '.git', 'worktrees', 'wt');
    mkdirSync(wtGitDir, { recursive: true });
    writeFileSync(join(wtGitDir, 'commondir'), '../..\n');
    const wt = join(root, 'wt');
    mkdirSync(wt);
    writeFileSync(join(wt, '.git'), 'gitdir: ../main/.git/worktrees/wt\n');

    expect(resolveGitDir(wt)).toBe(resolve(wt, '../main/.git/worktrees/wt'));
    expect(resolveCommonGitDir(wt)).toBe(resolve(wtGitDir, '../..'));
  });

  it('нет .git — дефолтный путь, без кэширования', () => {
    const repo = join(root, 'later');
    expect(resolveGitDir(repo)).toBe(join(repo, '.git'));
  });
});
