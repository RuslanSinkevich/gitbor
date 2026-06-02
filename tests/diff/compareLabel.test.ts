import { describe, it, expect } from 'vitest';
import { shortRev, isParentOf, buildCompareLabel } from '../../src/renderer/src/features/diff/compareLabel';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf899d15d4cef8de1';

const STR = {
  vsPrevious: 'VS_PREV',
  sinceCreation: 'SINCE_CREATION',
  range: (from: string, to: string) => `${from}>>${to}`,
};

describe('shortRev', () => {
  it('takes first 7 chars of a full hash', () => {
    expect(shortRev('e8ff593abcdef0123456789')).toBe('e8ff593');
  });

  it('strips ^ / ^1 / ~N suffixes before shortening', () => {
    expect(shortRev('e8ff593abcdef^1')).toBe('e8ff593');
    expect(shortRev('e8ff593abcdef^')).toBe('e8ff593');
    expect(shortRev('e8ff593abcdef~3')).toBe('e8ff593');
  });

  it('leaves short refs untouched', () => {
    expect(shortRev('main')).toBe('main');
  });
});

describe('isParentOf', () => {
  it('detects <to>^ and <to>^1', () => {
    expect(isParentOf('abc123^', 'abc123')).toBe(true);
    expect(isParentOf('abc123^1', 'abc123')).toBe(true);
  });

  it('rejects unrelated revs', () => {
    expect(isParentOf('def456', 'abc123')).toBe(false);
  });
});

describe('buildCompareLabel', () => {
  it('says "vs previous" when comparing a commit with its parent', () => {
    expect(buildCompareLabel('abc123^', 'abc123', STR)).toBe('VS_PREV');
    expect(buildCompareLabel('abc123^1', 'abc123', STR)).toBe('VS_PREV');
  });

  it('says "since creation" when comparing against the empty tree', () => {
    expect(buildCompareLabel(EMPTY_TREE, 'abc123', STR)).toBe('SINCE_CREATION');
    expect(buildCompareLabel(`${EMPTY_TREE}`, 'abc123', STR)).toBe('SINCE_CREATION');
  });

  it('renders short range for an arbitrary pair', () => {
    expect(buildCompareLabel('1111111aaaa', '2222222bbbb', STR)).toBe('1111111>>2222222');
  });
});
