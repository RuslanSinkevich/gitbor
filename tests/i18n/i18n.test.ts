import { describe, it, expect } from 'vitest';
import { en } from '../../src/renderer/src/i18n/en';
import { ru } from '../../src/renderer/src/i18n/ru';

type LocaleNode = string | { [key: string]: LocaleNode };
type LocaleTree = Record<string, LocaleNode>;

function flattenKeys(obj: LocaleTree, prefix = ''): string[] {
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
    function checkNoEmpty(obj: LocaleTree, path = ''): string[] {
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
    function checkNoEmpty(obj: LocaleTree, path = ''): string[] {
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

    function compareTemplates(enObj: LocaleTree, ruObj: LocaleTree, path = ''): string[] {
      const mismatches: string[] = [];
      for (const [k, v] of Object.entries(enObj)) {
        const p = path ? `${path}.${k}` : k;
        if (typeof v === 'string') {
          const ruVal = ruObj[k];
          const enP = getPlaceholders(v);
          const ruP = getPlaceholders(typeof ruVal === 'string' ? ruVal : '');
          if (JSON.stringify(enP) !== JSON.stringify(ruP)) {
            mismatches.push(`${p}: en=${enP.join(',')} ru=${ruP.join(',')}`);
          }
        } else if (typeof v === 'object' && v !== null) {
          const ruVal = ruObj[k];
          if (typeof ruVal === 'object' && ruVal !== null) {
            mismatches.push(...compareTemplates(v, ruVal, p));
          }
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
