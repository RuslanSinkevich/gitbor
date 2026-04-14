import { describe, it, expect } from 'vitest';
import type { RendererCommand, MainEvent } from '../../src/core/bridge/messages';

describe('RendererCommand types', () => {
  it('git operations have correct shape', () => {
    const fetch: RendererCommand = { type: 'fetch' };
    const pull: RendererCommand = { type: 'pull', rebase: true };
    const push: RendererCommand = { type: 'push', force: true, setUpstream: true };
    const commit: RendererCommand = { type: 'commit', message: 'test', amend: false };

    expect(fetch.type).toBe('fetch');
    expect(pull.type).toBe('pull');
    expect(push.type).toBe('push');
    expect(commit.type).toBe('commit');
  });

  it('branch operations have correct shape', () => {
    const create: RendererCommand = { type: 'createBranch', name: 'dev', from: 'main' };
    const rename: RendererCommand = { type: 'renameBranch', oldName: 'dev', newName: 'develop' };
    const del: RendererCommand = { type: 'deleteBranch', branch: 'old', force: true };

    expect(create.type).toBe('createBranch');
    expect(rename.type).toBe('renameBranch');
    expect(del.type).toBe('deleteBranch');
  });

  it('merge operations have correct shape', () => {
    const start: RendererCommand = { type: 'startMerge', source: 'dev', options: {} };
    const ours: RendererCommand = { type: 'resolveWithOurs', file: 'a.ts' };
    const theirs: RendererCommand = { type: 'resolveWithTheirs', file: 'a.ts' };
    const abort: RendererCommand = { type: 'abortMerge' };

    expect(start.type).toBe('startMerge');
    expect(ours.type).toBe('resolveWithOurs');
    expect(theirs.type).toBe('resolveWithTheirs');
    expect(abort.type).toBe('abortMerge');
  });

  it('reflog commands have correct shape', () => {
    const get: RendererCommand = { type: 'getReflog', maxCount: 50 };
    const restore: RendererCommand = { type: 'restoreReflog', hash: 'abc123' };
    expect(get.type).toBe('getReflog');
    expect(restore.type).toBe('restoreReflog');
  });

  it('bisect commands have correct shape', () => {
    const start: RendererCommand = { type: 'bisectStart', bad: 'abc', good: 'def' };
    const good: RendererCommand = { type: 'bisectGood' };
    const bad: RendererCommand = { type: 'bisectBad' };
    const skip: RendererCommand = { type: 'bisectSkip' };
    const reset: RendererCommand = { type: 'bisectReset' };

    expect(start.type).toBe('bisectStart');
    expect(good.type).toBe('bisectGood');
    expect(bad.type).toBe('bisectBad');
    expect(skip.type).toBe('bisectSkip');
    expect(reset.type).toBe('bisectReset');
  });

  it('lfs commands have correct shape', () => {
    const status: RendererCommand = { type: 'getLfsStatus' };
    const track: RendererCommand = { type: 'lfsTrack', pattern: '*.psd' };
    const untrack: RendererCommand = { type: 'lfsUntrack', pattern: '*.psd' };

    expect(status.type).toBe('getLfsStatus');
    expect(track.type).toBe('lfsTrack');
    expect(untrack.type).toBe('lfsUntrack');
  });

  it('worktree commands have correct shape', () => {
    const list: RendererCommand = { type: 'getWorktrees' };
    const add: RendererCommand = { type: 'addWorktree', path: '/tmp/wt', branch: 'dev', createBranch: true };
    const remove: RendererCommand = { type: 'removeWorktree', path: '/tmp/wt', force: false };

    expect(list.type).toBe('getWorktrees');
    expect(add.type).toBe('addWorktree');
    expect(remove.type).toBe('removeWorktree');
  });

  it('hooks commands have correct shape', () => {
    const list: RendererCommand = { type: 'getHooks' };
    const toggle: RendererCommand = { type: 'toggleHook', name: 'pre-commit', enable: false };

    expect(list.type).toBe('getHooks');
    expect(toggle.type).toBe('toggleHook');
  });
});

describe('MainEvent types', () => {
  it('error event has message', () => {
    const evt: MainEvent = { type: 'error', message: 'something failed' };
    expect(evt.type).toBe('error');
  });

  it('operation events have correct shape', () => {
    const start: MainEvent = { type: 'operationStart', operation: 'fetch' };
    const end: MainEvent = { type: 'operationEnd', operation: 'fetch', success: true };
    const fail: MainEvent = { type: 'operationEnd', operation: 'push', success: false, error: 'rejected' };

    expect(start.type).toBe('operationStart');
    expect(end.type).toBe('operationEnd');
    expect(fail.type).toBe('operationEnd');
  });

  it('bisect events have correct shape', () => {
    const status: MainEvent = {
      type: 'bisectStatus',
      data: { active: true, current: 'abc', stepsLeft: 3, goodCount: 1, badCount: 1, log: [] },
    };
    const output: MainEvent = { type: 'bisectOutput', output: 'Bisecting: 5 revisions left' };

    expect(status.type).toBe('bisectStatus');
    expect(output.type).toBe('bisectOutput');
  });
});
