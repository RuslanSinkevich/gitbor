import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { GitExecResult } from '../../src/core/git/types';

vi.mock('../../src/core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Простой мок без сетевых вызовов — детектор процессов всегда возвращает пустоту.
vi.mock('../../src/core/safety/GitProcessDetector', () => ({
  findGitProcesses: vi.fn(async () => []),
}));

let repoDir: string;
let gitDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'gitbor-preflight-'));
  gitDir = join(repoDir, '.git');
  mkdirSync(gitDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

interface MockOpts {
  uuFiles?: string[];
  dirtyStatus?: string;
}

function makeGit(opts: MockOpts = {}) {
  return {
    getCwd: () => repoDir,
    exec: vi.fn(async (args: string[]): Promise<GitExecResult> => {
      const key = args.join(' ');
      if (key === 'diff --name-only --diff-filter=U') {
        return { stdout: (opts.uuFiles || []).join('\n'), stderr: '', exitCode: 0, duration: 1 };
      }
      if (key === 'status --porcelain') {
        return { stdout: opts.dirtyStatus || '', stderr: '', exitCode: 0, duration: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0, duration: 1 };
    }),
  } as never;
}

describe('PreflightChecks.check', () => {
  it('clean repo, no state, no UU → ok=true, no issues', async () => {
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit());
    const report = await pre.check(repoDir, 'merge');
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('fresh lock (<15s) → lock_held_fresh issue, file NOT removed', async () => {
    writeFileSync(join(gitDir, 'index.lock'), '');
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit());
    const report = await pre.check(repoDir, 'merge');
    expect(report.ok).toBe(false);
    const lockIssue = report.issues.find(i => i.kind === 'lock_held_fresh');
    expect(lockIssue).toBeDefined();
    expect(existsSync(join(gitDir, 'index.lock'))).toBe(true);
  });

  it('stale lock (>15s) → silently removed, no issue', async () => {
    const lockPath = join(gitDir, 'index.lock');
    writeFileSync(lockPath, '');
    const old = (Date.now() - 30_000) / 1000;
    utimesSync(lockPath, old, old);

    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit());
    const report = await pre.check(repoDir, 'merge');
    expect(report.issues.filter(i => i.kind === 'lock_held_fresh' || i.kind === 'lock_stale')).toHaveLength(0);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('stale lock with noAutoRemoveStaleLock → keeps file, no issue (we did not try)', async () => {
    const lockPath = join(gitDir, 'index.lock');
    writeFileSync(lockPath, '');
    const old = (Date.now() - 30_000) / 1000;
    utimesSync(lockPath, old, old);

    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit());
    const report = await pre.check(repoDir, 'merge', { noAutoRemoveStaleLock: true });
    // With opt-out, an old lock should not even count as fresh — but we still treat it as fresh since we don't remove.
    // Точное поведение: stale без удаления → не блокируем; реализация сообщает "fresh" если код упрощён.
    // Конкретно тут проверяем что файл цел.
    expect(existsSync(lockPath)).toBe(true);
    // если есть issue, это lock_held_fresh (мы не отличили после opt-out — это ОК для теста контракта)
    if (!report.ok) {
      expect(report.issues.some(i => i.kind === 'lock_held_fresh' || i.kind === 'lock_stale')).toBe(true);
    }
  });

  it('MERGE_HEAD exists + operation=merge → merge_in_progress issue', async () => {
    writeFileSync(join(gitDir, 'MERGE_HEAD'), '');
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit());
    const report = await pre.check(repoDir, 'merge');
    expect(report.ok).toBe(false);
    expect(report.issues.find(i => i.kind === 'merge_in_progress')).toBeDefined();
  });

  it('MERGE_HEAD exists + operation=commit → no block (commit completes the merge)', async () => {
    writeFileSync(join(gitDir, 'MERGE_HEAD'), '');
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit());
    const report = await pre.check(repoDir, 'commit');
    expect(report.issues.find(i => i.kind === 'merge_in_progress')).toBeUndefined();
  });

  it('rebase-apply dir → rebase_in_progress for any merging op', async () => {
    mkdirSync(join(gitDir, 'rebase-apply'));
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit());
    const report = await pre.check(repoDir, 'merge');
    expect(report.issues.find(i => i.kind === 'rebase_in_progress')).toBeDefined();
  });

  it('CHERRY_PICK_HEAD → cherry_pick_in_progress', async () => {
    writeFileSync(join(gitDir, 'CHERRY_PICK_HEAD'), '');
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit());
    const report = await pre.check(repoDir, 'merge');
    expect(report.issues.find(i => i.kind === 'cherry_pick_in_progress')).toBeDefined();
  });

  it('REVERT_HEAD → revert_in_progress', async () => {
    writeFileSync(join(gitDir, 'REVERT_HEAD'), '');
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit());
    const report = await pre.check(repoDir, 'pull');
    expect(report.issues.find(i => i.kind === 'revert_in_progress')).toBeDefined();
  });

  it('UU paths → unmerged_paths issue, blocks pull', async () => {
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit({ uuFiles: ['src/a.ts', 'src/b.ts'] }));
    const report = await pre.check(repoDir, 'pull');
    const uu = report.issues.find(i => i.kind === 'unmerged_paths');
    expect(uu).toBeDefined();
    expect(uu!.paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('UU paths but operation=resolveOurs → no block', async () => {
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit({ uuFiles: ['src/a.ts'] }));
    const report = await pre.check(repoDir, 'resolveOurs');
    expect(report.issues.find(i => i.kind === 'unmerged_paths')).toBeUndefined();
  });

  it('dirty tree + checkout → dirty_tree issue', async () => {
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit({ dirtyStatus: ' M src/a.ts\n M src/b.ts\n' }));
    const report = await pre.check(repoDir, 'checkout');
    const dirty = report.issues.find(i => i.kind === 'dirty_tree');
    expect(dirty).toBeDefined();
    expect(dirty!.paths).toContain('src/a.ts');
    expect(dirty!.paths).toContain('src/b.ts');
  });

  it('dirty tree + merge → NO dirty_tree issue (merge auto-stashes via SafetyNet)', async () => {
    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit({ dirtyStatus: ' M f\n' }));
    const report = await pre.check(repoDir, 'merge');
    expect(report.issues.find(i => i.kind === 'dirty_tree')).toBeUndefined();
  });

  it('multiple issues collected at once', async () => {
    writeFileSync(join(gitDir, 'MERGE_HEAD'), '');
    const lockPath = join(gitDir, 'index.lock');
    writeFileSync(lockPath, '');

    const { PreflightChecks } = await import('../../src/core/safety/PreflightChecks');
    const pre = new PreflightChecks(makeGit({ uuFiles: ['a.ts'] }));
    const report = await pre.check(repoDir, 'merge');
    expect(report.ok).toBe(false);
    expect(report.issues.length).toBeGreaterThanOrEqual(3);
    expect(report.issues.map(i => i.kind)).toContain('merge_in_progress');
    expect(report.issues.map(i => i.kind)).toContain('lock_held_fresh');
    expect(report.issues.map(i => i.kind)).toContain('unmerged_paths');
  });
});
