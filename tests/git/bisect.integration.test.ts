import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { GitExecutor } from '@core/git/GitExecutor';
import { BisectManager, bisectStepsLeft } from '@core/git/BisectManager';

vi.mock('@core/utils/Logger', () => ({
  mainLogger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

/** «~N шагов осталось» = сколько ещё раз нажать «Хороший/Плохой»; в конце — «Найден». */
describe('bisect на настоящем git', () => {
  it('счётчик шагов совпадает с числом оставшихся нажатий', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'gitbor-bisect-'));
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
    try {
      git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
      for (let i = 1; i <= 16; i++) { writeFileSync(join(repo, 'v.txt'), `${i}\n`); git('add', '.'); git('commit', '-qm', `c${i}`); }
      const bm = new BisectManager(new GitExecutor(repo));
      await bm.start('HEAD', 'HEAD~15');
      const shown: number[] = [];
      for (let guard = 0; guard < 10; guard++) {
        const s = await bm.getStatus();
        if (s.found) break;
        shown.push(s.stepsLeft);
        const n = Number(git('show', '-s', '--format=%s', 'HEAD').trim().slice(1));
        await (n >= 11 ? bm.markBad() : bm.markGood()); // баг появился в c11
      }
      const final = await bm.getStatus();
      expect(final.found).toBe(true);
      expect(final.stepsLeft).toBe(0);
      expect(git('show', '-s', '--format=%s', 'refs/bisect/bad').trim()).toBe('c11');
      // Каждый показ — ровно столько нажатий, сколько реально осталось.
      expect(shown).toEqual(shown.map((_, i) => shown.length - i));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
    // 16 коммитов и bisect на настоящем git: в общем прогоне под нагрузкой дольше 10 с.
  }, 60_000);

  it('bisectStepsLeft', () => {
    expect([1, 2, 4, 8, 15].map(bisectStepsLeft)).toEqual([0, 1, 2, 3, 4]);
  });
});
