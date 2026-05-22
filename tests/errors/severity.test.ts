import { describe, it, expect } from 'vitest';
import {
  classToSeverity,
  resolveToastLevel,
  shouldShowSafetyModal,
  extractErrorHost,
} from '../../src/core/errors/severity';

describe('classToSeverity', () => {
  it('maps network to info', () => {
    expect(classToSeverity('network')).toBe('info');
  });
  it('maps unknown to critical', () => {
    expect(classToSeverity('unknown')).toBe('critical');
  });
  it('maps hook_failed to warning', () => {
    expect(classToSeverity('hook_failed')).toBe('warning');
  });
});

describe('resolveToastLevel', () => {
  it('background + info → no toast', () => {
    expect(resolveToastLevel('background', 'info')).toBeNull();
  });
  it('user + network(info) → info toast', () => {
    expect(resolveToastLevel('user', 'info')).toBe('info');
  });
  it('user + unknown(critical) → error toast', () => {
    expect(resolveToastLevel('user', 'critical')).toBe('error');
  });
  it('user + auth(warning) → warning toast', () => {
    expect(resolveToastLevel('user', 'warning')).toBe('warning');
  });
});

describe('shouldShowSafetyModal', () => {
  it('only user + critical', () => {
    expect(shouldShowSafetyModal('user', 'critical')).toBe(true);
    expect(shouldShowSafetyModal('user', 'warning')).toBe(false);
    expect(shouldShowSafetyModal('background', 'critical')).toBe(false);
  });
});

describe('extractErrorHost', () => {
  it('parses https host', () => {
    expect(extractErrorHost('fatal: unable to access https://tfs.example.com/foo/bar'))
      .toBe('tfs.example.com');
  });
});
