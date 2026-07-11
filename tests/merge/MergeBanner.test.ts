import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/renderer/src/api', () => ({
  postCommand: vi.fn(),
}));

import {
  isCherryPickSeries,
  shouldShowMergeBanner,
} from '../../src/renderer/src/features/merge/MergeBanner';
import type { MergeState } from '../../src/renderer/src/types';

function merge(over: Partial<MergeState> = {}): MergeState {
  return {
    inProgress: true,
    kind: 'merge',
    conflictFiles: [],
    totalConflicts: 0,
    sourceBranch: '',
    targetBranch: 'main',
    ...over,
  };
}

describe('isCherryPickSeries', () => {
  it('true только пока total > done', () => {
    expect(isCherryPickSeries(merge({ kind: 'cherry-pick', sequencerDone: 1, sequencerTotal: 3 }))).toBe(true);
    expect(isCherryPickSeries(merge({ kind: 'cherry-pick', sequencerDone: 3, sequencerTotal: 3 }))).toBe(false);
    expect(isCherryPickSeries(merge({ kind: 'cherry-pick', sequencerDone: 0, sequencerTotal: 0 }))).toBe(false);
    expect(isCherryPickSeries(merge({ kind: 'merge', sequencerDone: 0, sequencerTotal: 3 }))).toBe(false);
  });
});

describe('shouldShowMergeBanner', () => {
  it('держит баннер серии после разрешения конфликтов', () => {
    const state = merge({
      kind: 'cherry-pick',
      sequencerDone: 1,
      sequencerTotal: 4,
      totalConflicts: 2,
      conflictFiles: [
        { path: 'a.ts', status: 'resolved' },
        { path: 'b.ts', status: 'resolved' },
      ],
    });
    expect(shouldShowMergeBanner(state)).toBe(true);
  });

  it('скрывает баннер когда серия дошла до конца', () => {
    const state = merge({
      kind: 'cherry-pick',
      sequencerDone: 3,
      sequencerTotal: 3,
      totalConflicts: 0,
      conflictFiles: [],
    });
    expect(shouldShowMergeBanner(state)).toBe(false);
  });

  it('обычный merge без конфликтов — баннер скрыт', () => {
    expect(shouldShowMergeBanner(merge({ totalConflicts: 0, conflictFiles: [] }))).toBe(false);
  });
});
