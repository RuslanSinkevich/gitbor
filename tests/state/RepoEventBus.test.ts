import { describe, it, expect, vi } from 'vitest';
import { RepoEventBus } from '../../src/core/state/RepoEventBus';
import type { AppState } from '../../src/core/git/types';

function emptyState(): AppState {
  return {
    repoPath: '/repo',
    branches: [], tags: [], stashes: [], remotes: [],
    submodules: [],
    commits: [], graphLayout: { nodes: [], maxColumns: 0, mergeLinks: [] },
    status: { staged: [], unstaged: [], untracked: [], conflicted: [], renamed: [] },
    currentBranch: '', ahead: 0, behind: 0,
    isOperationRunning: false,
    mergeState: { inProgress: false, files: [] },
    rebaseProgress: { inProgress: false, current: 0, total: 0, action: '', sha: '', subject: '' },
    recoveryIssues: [],
  } as unknown as AppState;
}

describe('RepoEventBus.subscribe', () => {
  it('invokes subscribed listener on notify with the snapshot', () => {
    const bus = new RepoEventBus();
    const spy = vi.fn();
    bus.subscribe(spy);
    const snap = emptyState();
    bus.notify(snap);
    expect(spy).toHaveBeenCalledExactlyOnceWith(snap);
  });

  it('invokes all subscribed listeners independently', () => {
    const bus = new RepoEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    bus.notify(emptyState());
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('returns an unsubscribe function that removes the listener', () => {
    const bus = new RepoEventBus();
    const spy = vi.fn();
    const off = bus.subscribe(spy);
    off();
    bus.notify(emptyState());
    expect(spy).not.toHaveBeenCalled();
  });

  it('isolates listener exceptions — others still receive notify', () => {
    const bus = new RepoEventBus();
    const throwing = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    bus.subscribe(throwing);
    bus.subscribe(good);
    expect(() => bus.notify(emptyState())).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('stateListenerCount tracks active subscribers', () => {
    const bus = new RepoEventBus();
    expect(bus.stateListenerCount).toBe(0);
    const off1 = bus.subscribe(() => {});
    const off2 = bus.subscribe(() => {});
    expect(bus.stateListenerCount).toBe(2);
    off1();
    expect(bus.stateListenerCount).toBe(1);
    off2();
    expect(bus.stateListenerCount).toBe(0);
  });
});

describe('RepoEventBus.onRepoSwitch', () => {
  it('notifies listeners on switch', () => {
    const bus = new RepoEventBus();
    const spy = vi.fn();
    bus.onRepoSwitch(spy);
    bus.notifyRepoSwitch('/new');
    expect(spy).toHaveBeenCalledExactlyOnceWith('/new');
  });

  it('unsubscribe stops further notifications', () => {
    const bus = new RepoEventBus();
    const spy = vi.fn();
    const off = bus.onRepoSwitch(spy);
    off();
    bus.notifyRepoSwitch('/x');
    expect(spy).not.toHaveBeenCalled();
  });

  it('isolates listener exceptions', () => {
    const bus = new RepoEventBus();
    const boom = vi.fn(() => { throw new Error('x'); });
    const ok = vi.fn();
    bus.onRepoSwitch(boom);
    bus.onRepoSwitch(ok);
    expect(() => bus.notifyRepoSwitch('/x')).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('RepoEventBus.onRepoClose', () => {
  it('notifies listeners on close', () => {
    const bus = new RepoEventBus();
    const spy = vi.fn();
    bus.onRepoClose(spy);
    bus.notifyRepoClose('/closed');
    expect(spy).toHaveBeenCalledExactlyOnceWith('/closed');
  });

  it('unsubscribe stops further close-notifications', () => {
    const bus = new RepoEventBus();
    const spy = vi.fn();
    const off = bus.onRepoClose(spy);
    off();
    bus.notifyRepoClose('/x');
    expect(spy).not.toHaveBeenCalled();
  });

  it('isolates listener exceptions', () => {
    const bus = new RepoEventBus();
    const boom = vi.fn(() => { throw new Error('x'); });
    const ok = vi.fn();
    bus.onRepoClose(boom);
    bus.onRepoClose(ok);
    expect(() => bus.notifyRepoClose('/x')).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('RepoEventBus channels are independent', () => {
  it('notify() does not fire repoSwitch / repoClose listeners', () => {
    const bus = new RepoEventBus();
    const sw = vi.fn();
    const cl = vi.fn();
    bus.onRepoSwitch(sw);
    bus.onRepoClose(cl);
    bus.notify(emptyState());
    expect(sw).not.toHaveBeenCalled();
    expect(cl).not.toHaveBeenCalled();
  });

  it('notifyRepoSwitch() does not fire state / repoClose listeners', () => {
    const bus = new RepoEventBus();
    const st = vi.fn();
    const cl = vi.fn();
    bus.subscribe(st);
    bus.onRepoClose(cl);
    bus.notifyRepoSwitch('/x');
    expect(st).not.toHaveBeenCalled();
    expect(cl).not.toHaveBeenCalled();
  });
});
