import { describe, it, expect } from 'vitest';
import { en } from '../../src/renderer/src/i18n/en';
import { ru } from '../../src/renderer/src/i18n/ru';

function flattenKeys(obj: Record<string, any>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      keys.push(...flattenKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe('i18n completeness', () => {
  const enKeys = flattenKeys(en).sort();
  const ruKeys = flattenKeys(ru).sort();

  it('en and ru have the same number of keys', () => {
    expect(enKeys.length).toBe(ruKeys.length);
  });

  it('every en key exists in ru', () => {
    const ruSet = new Set(ruKeys);
    const missing = enKeys.filter(k => !ruSet.has(k));
    expect(missing).toEqual([]);
  });

  it('every ru key exists in en', () => {
    const enSet = new Set(enKeys);
    const extra = ruKeys.filter(k => !enSet.has(k));
    expect(extra).toEqual([]);
  });

  it('no empty string values in en', () => {
    function checkNoEmpty(obj: Record<string, any>, path = ''): string[] {
      const empties: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const p = path ? `${path}.${k}` : k;
        if (typeof v === 'string' && v === '') empties.push(p);
        else if (typeof v === 'object' && v !== null) empties.push(...checkNoEmpty(v, p));
      }
      return empties;
    }
    expect(checkNoEmpty(en)).toEqual([]);
  });

  it('no empty string values in ru', () => {
    function checkNoEmpty(obj: Record<string, any>, path = ''): string[] {
      const empties: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const p = path ? `${path}.${k}` : k;
        if (typeof v === 'string' && v === '') empties.push(p);
        else if (typeof v === 'object' && v !== null) empties.push(...checkNoEmpty(v, p));
      }
      return empties;
    }
    expect(checkNoEmpty(ru)).toEqual([]);
  });

  it('all template placeholders in en exist in ru counterparts', () => {
    function getPlaceholders(s: string): string[] {
      const matches = s.match(/\{(\w+)\}/g);
      return matches ? matches.sort() : [];
    }

    function compareTemplates(enObj: Record<string, any>, ruObj: Record<string, any>, path = ''): string[] {
      const mismatches: string[] = [];
      for (const [k, v] of Object.entries(enObj)) {
        const p = path ? `${path}.${k}` : k;
        if (typeof v === 'string') {
          const enP = getPlaceholders(v);
          const ruP = getPlaceholders(ruObj[k] ?? '');
          if (JSON.stringify(enP) !== JSON.stringify(ruP)) {
            mismatches.push(`${p}: en=${enP.join(',')} ru=${ruP.join(',')}`);
          }
        } else if (typeof v === 'object' && v !== null && ruObj[k]) {
          mismatches.push(...compareTemplates(v, ruObj[k], p));
        }
      }
      return mismatches;
    }

    expect(compareTemplates(en, ru)).toEqual([]);
  });
});

describe('i18n structure', () => {
  it('has all top-level sections', () => {
    const expected = [
      'app', 'menu', 'toolbar', 'submodules', 'sidebar', 'graph', 'details',
      'changes', 'diff', 'fileHistory', 'blame', 'rebaseEditor', 'mergeEditor',
      'conflictPanel', 'mergeDialog', 'mergeBanner', 'conflictDialog',
      'contextMenu', 'merge', 'dialog', 'statusbar', 'recovery', 'repoManager',
      'operations', 'repoSettings', 'sshKeys', 'showcase',
      'lfs', 'worktrees', 'hooks', 'bisect', 'reflog',
    ];
    for (const section of expected) {
      expect(en).toHaveProperty(section);
      expect(ru).toHaveProperty(section);
    }
  });
});
