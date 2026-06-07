import { describe, it, expect } from 'vitest';
import { canPushDirectly, upstreamBranchShort, isPushDefaultMismatch } from '../../src/renderer/src/hooks/pushDestination';

describe('upstreamBranchShort', () => {
  it('parses remote/branch with known remote', () => {
    expect(upstreamBranchShort('origin/main', 'origin')).toBe('main');
  });

  it('parses nested branch path with remote prefix', () => {
    expect(
      upstreamBranchShort(
        'ConsumerCRM-techpris/feature/SinkevichRN/NRGIND-29340',
        'ConsumerCRM-techpris',
      ),
    ).toBe('feature/SinkevichRN/NRGIND-29340');
  });

  it('returns null when remote does not match', () => {
    expect(upstreamBranchShort('origin/main', 'other')).toBeNull();
  });

  it('falls back without remote filter', () => {
    expect(upstreamBranchShort('origin/main')).toBe('main');
    expect(upstreamBranchShort('solo-branch')).toBe('solo-branch');
  });

  it('returns null for empty upstream', () => {
    expect(upstreamBranchShort(undefined)).toBeNull();
    expect(upstreamBranchShort('')).toBeNull();
  });
});

describe('canPushDirectly', () => {
  it('allows push when local name matches upstream branch', () => {
    expect(canPushDirectly('main', 'origin/main')).toBe(true);
    expect(
      canPushDirectly(
        'feature/SinkevichRN/Finish/NRGIND-29340',
        'ConsumerCRM-techpris/feature/SinkevichRN/Finish/NRGIND-29340',
      ),
    ).toBe(true);
  });

  it('allows push for nested paths (regression: first-slash split broke this)', () => {
    expect(
      canPushDirectly(
        'feature/TiabinIA/AddImportOnPactModal',
        'ConsumerCRM-techpris/feature/TiabinIA/AddImportOnPactModal',
      ),
    ).toBe(true);
  });

  it('requires dialog when upstream points to different branch (Fork case)', () => {
    expect(
      canPushDirectly(
        'feature/SinkevichRN/Finish/NRGIND-29340',
        'ConsumerCRM-techpris/feature/SinkevichRN/NRGIND-29340',
      ),
    ).toBe(false);
  });

  it('requires dialog when there is no upstream', () => {
    expect(canPushDirectly('feature/foo', undefined)).toBe(false);
  });

  it('requires dialog when current branch is empty', () => {
    expect(canPushDirectly('', 'origin/main')).toBe(false);
  });
});

describe('isPushDefaultMismatch', () => {
  it('detects the canonical push.default=simple mismatch message (multiline)', () => {
    const stderr = [
      'fatal: The upstream branch of your current branch does not match',
      'the name of your current branch.  To push to the upstream branch',
      'on the remote, use',
      '',
      '    git push origin HEAD:feature/old-name',
      '',
      'To push to the branch of the same name on the remote, use',
      '',
      '    git push origin HEAD',
    ].join('\n');
    expect(isPushDefaultMismatch(stderr)).toBe(true);
  });

  it('is whitespace/case tolerant', () => {
    expect(
      isPushDefaultMismatch(
        'FATAL: the   upstream BRANCH of your current branch\n\tdoes not match the name OF your current branch.',
      ),
    ).toBe(true);
  });

  it('does NOT match non-fast-forward rejections', () => {
    expect(
      isPushDefaultMismatch(
        'error: failed to push some refs to \'origin\'\nhint: Updates were rejected because the tip of your current branch is behind',
      ),
    ).toBe(false);
  });

  it('does NOT match no-upstream message (already handled before push)', () => {
    expect(
      isPushDefaultMismatch('fatal: The current branch feature/foo has no upstream branch.'),
    ).toBe(false);
  });

  it('returns false for empty / nullish input', () => {
    expect(isPushDefaultMismatch('')).toBe(false);
    expect(isPushDefaultMismatch(undefined)).toBe(false);
    expect(isPushDefaultMismatch(null)).toBe(false);
  });
});
