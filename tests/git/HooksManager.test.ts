import { describe, it, expect } from 'vitest';
import type { HookInfo } from '../../src/core/git/HooksManager';

describe('HookInfo (contract)', () => {
  it('enabled hook has correct shape', () => {
    const hook: HookInfo = {
      name: 'pre-commit',
      enabled: true,
      content: '#!/bin/sh\nexit 0',
    };
    expect(hook.name).toBe('pre-commit');
    expect(hook.enabled).toBe(true);
    expect(hook.content).toContain('#!/bin/sh');
  });

  it('disabled hook has correct shape', () => {
    const hook: HookInfo = {
      name: 'post-commit',
      enabled: false,
      content: '#!/bin/bash\necho done',
    };
    expect(hook.enabled).toBe(false);
  });
});
