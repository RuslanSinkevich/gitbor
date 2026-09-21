import { describe, it, expect } from 'vitest';
import { ancestorFolderPaths, matchRemoteName, treeAncestorPaths } from '../../src/renderer/src/features/sidebar/branchTreePaths';

describe('ancestorFolderPaths', () => {
  it('returns empty for a leaf name', () => {
    expect(ancestorFolderPaths('main')).toEqual([]);
  });

  it('returns the parent folder for a single nest', () => {
    expect(ancestorFolderPaths('feature/login')).toEqual(['feature']);
  });

  it('returns all parent folders for a deep path', () => {
    expect(ancestorFolderPaths('a/b/c')).toEqual(['a', 'a/b']);
  });

  it('ignores empty / missing names', () => {
    expect(ancestorFolderPaths('')).toEqual([]);
    expect(ancestorFolderPaths('//')).toEqual([]);
  });
});

describe('treeAncestorPaths', () => {
  it('matches buildBranchTree remote fullPath (prefix + slash + segment)', () => {
    expect(treeAncestorPaths('origin/feature/login', 'origin/')).toEqual(['origin//feature']);
  });
});

describe('matchRemoteName', () => {
  it('prefers the longest matching remote name', () => {
    expect(matchRemoteName('my-origin/foo', ['origin', 'my-origin']))
      .toEqual({ remote: 'my-origin', prefix: 'my-origin/' });
  });

  it('falls back to the first path segment', () => {
    expect(matchRemoteName('upstream/dev', [])).toEqual({ remote: 'upstream', prefix: 'upstream/' });
  });

  it('returns null for a leaf without slash', () => {
    expect(matchRemoteName('HEAD', ['origin'])).toBeNull();
  });
});
