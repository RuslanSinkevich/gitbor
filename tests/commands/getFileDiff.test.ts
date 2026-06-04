import { describe, it, expect } from 'vitest';
import type { GitExecutor } from '@core/git/GitExecutor';
import type { OperationQueue } from '@core/safety/OperationQueue';
import { getFileDiff } from '@core/commands/readCommands';
import { makeScriptedGit, makeMockQueue, type MockGit } from '../_mocks';

const asGit = (m: MockGit) => m as unknown as GitExecutor;
const asQueue = (m: ReturnType<typeof makeMockQueue>) => m as unknown as OperationQueue;

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf899d15d4cef8de1';
const FULL_CTX = '-U2000000000';

function smallDiff(path = 'f.txt'): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,1 +1,1 @@',
    '-old',
    '+new',
    '',
  ].join('\n');
}

function bigDiff(lines: number, path = 'f.txt'): string {
  const body = Array.from({ length: lines }, (_, i) => `+line${i}`).join('\n');
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines} @@`,
    body,
    '',
  ].join('\n');
}

/** Args самого первого вызова git diff (не log/ls-files/rev-list). */
function firstDiffCall(git: MockGit): string[] {
  // Diff читается через execBuffer (см. runDiff в readCommands) — там нужны
  // байты, чтобы корректно декодировать legacy-кодировки (cp1251/cp866).
  const call = git.execBuffer.mock.calls.find((c) => (c[0] as string[])[0] === 'diff');
  return (call?.[0] as string[]) ?? [];
}

describe('getFileDiff — PREV: sentinel', () => {
  it('resolves PREV: to prev..target using the previous revision that touched the file', async () => {
    const git = makeScriptedGit({
      'log -2 --format=%H': { stdout: 'TARGETHASH\nPREVHASH\n' },
      'diff': { stdout: smallDiff() },
    });
    const res = await getFileDiff(asQueue(makeMockQueue()), asGit(git), 'f.txt', 'PREV:TARGETHASH');

    expect(res).toHaveLength(1);
    const diffArgs = firstDiffCall(git);
    expect(diffArgs).toContain('PREVHASH');
    expect(diffArgs).toContain('TARGETHASH');
  });

  it('falls back to empty tree when the file was created in the target commit', async () => {
    const git = makeScriptedGit({
      'log -2 --format=%H': { stdout: 'TARGETHASH\n' },
      'diff': { stdout: smallDiff() },
    });
    await getFileDiff(asQueue(makeMockQueue()), asGit(git), 'f.txt', 'PREV:TARGETHASH');

    const diffArgs = firstDiffCall(git);
    expect(diffArgs).toContain(EMPTY_TREE);
    expect(diffArgs).toContain('TARGETHASH');
  });
});

describe('getFileDiff — fullContext', () => {
  it('passes the whole-file context flag when requested', async () => {
    const git = makeScriptedGit({ 'diff': { stdout: smallDiff() } });
    await getFileDiff(asQueue(makeMockQueue()), asGit(git), 'f.txt', 'abc123', false, true);

    expect(firstDiffCall(git)).toContain(FULL_CTX);
  });

  it('omits the context flag for normal diffs', async () => {
    const git = makeScriptedGit({ 'diff': { stdout: smallDiff() } });
    await getFileDiff(asQueue(makeMockQueue()), asGit(git), 'f.txt', 'abc123', false, false);

    expect(firstDiffCall(git)).not.toContain(FULL_CTX);
  });

  it('does not flag normal-sized whole-file diffs', async () => {
    const git = makeScriptedGit({ 'diff': { stdout: bigDiff(100) } });
    const res = await getFileDiff(asQueue(makeMockQueue()), asGit(git), 'f.txt', 'abc123', false, true);

    expect(res[0].tooLargeForWhole).toBeUndefined();
  });
});

describe('getFileDiff — size guard', () => {
  it('falls back to default context and flags tooLargeForWhole past the line limit', async () => {
    // Full-context (-U…) отдаёт гигантский diff, обычный — компактный.
    const git = makeScriptedGit({
      [FULL_CTX]: { stdout: bigDiff(60001) },
      'diff': { stdout: smallDiff() },
    });
    const res = await getFileDiff(asQueue(makeMockQueue()), asGit(git), 'f.txt', 'abc123', false, true);

    expect(res).toHaveLength(1);
    expect(res[0].tooLargeForWhole).toBe(true);
    // Возвращается именно компактный fallback, а не 60001-строчный full diff.
    const totalLines = res[0].hunks.reduce((n, h) => n + h.lines.length, 0);
    expect(totalLines).toBeLessThan(60000);
  });
});
