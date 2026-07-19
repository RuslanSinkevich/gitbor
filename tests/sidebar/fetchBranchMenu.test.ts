import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promptFetchBranch } from '../../src/renderer/src/features/sidebar/sidebarMenuItems';
import type { Branch } from '../../src/renderer/src/types';
import { t } from '../../src/renderer/src/i18n';

vi.mock('../../src/renderer/src/api', () => ({
  postCommand: vi.fn(),
  copyToClipboard: vi.fn(),
}));

import { postCommand } from '../../src/renderer/src/api';

function localBranch(partial: Partial<Branch> & { name: string }): Branch {
  return {
    name: partial.name,
    hash: partial.hash ?? 'abc',
    isCurrent: partial.isCurrent ?? false,
    isRemote: false,
    upstream: partial.upstream,
  };
}

describe('promptFetchBranch', () => {
  const loc = t();
  const showPrompt = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches immediately when upstream is known', () => {
    promptFetchBranch(localBranch({ name: 'feature', upstream: 'origin/feature' }), loc, showPrompt, ['origin']);
    expect(postCommand).toHaveBeenCalledWith({ type: 'fetchBranch', branch: 'feature' });
    expect(showPrompt).not.toHaveBeenCalled();
  });

  it('opens select dialog when upstream is missing', () => {
    promptFetchBranch(localBranch({ name: 'feature' }), loc, showPrompt, ['origin', 'upstream']);
    expect(postCommand).not.toHaveBeenCalled();
    expect(showPrompt).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'select',
      defaultValue: 'origin',
      options: [
        { value: 'origin', label: 'origin' },
        { value: 'upstream', label: 'upstream' },
      ],
    }));
  });

  it('posts fetchBranch with remote and setUpstream after select confirm', () => {
    promptFetchBranch(localBranch({ name: 'feature' }), loc, showPrompt, ['origin']);
    const opts = showPrompt.mock.calls[0][0];
    opts.onConfirm('origin');
    expect(postCommand).toHaveBeenCalledWith({
      type: 'fetchBranch',
      branch: 'feature',
      remote: 'origin',
      setUpstream: true,
    });
  });

  it('shows no-remotes confirm when remote list is empty', () => {
    promptFetchBranch(localBranch({ name: 'feature' }), loc, showPrompt, []);
    expect(postCommand).not.toHaveBeenCalled();
    expect(showPrompt).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'confirm',
      message: loc.contextMenu.fetchBranchNoRemotes,
    }));
  });
});
