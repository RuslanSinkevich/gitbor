import { describe, it, expect } from 'vitest';
import {
  buildFileTree,
  collectFiles,
  flattenTree,
  collectFolderPaths,
  isFolderNode,
  type FileTreeNode,
} from '../../src/renderer/src/features/changes/fileTreeModel';
import type { FileStatus } from '../../src/core/git/types/git';

function fs(path: string, status: FileStatus['status'] = 'M', staged = false): FileStatus {
  return { path, status, staged };
}

describe('buildFileTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it('builds a flat tree for files in root', () => {
    const tree = buildFileTree([fs('a.txt'), fs('b.txt')]);
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe('a.txt');
    expect(tree[0].file).toMatchObject({ path: 'a.txt' });
    expect(tree[0].children).toEqual([]);
  });

  it('groups files into nested folders', () => {
    const tree = buildFileTree([fs('src/a.ts'), fs('src/b.ts'), fs('readme.md')]);
    const folder = tree.find((n) => n.name === 'src')!;
    expect(folder.file).toBeNull();
    expect(folder.children).toHaveLength(2);
    expect(folder.children.map((c) => c.name).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('puts folders before leaf files within the same parent', () => {
    const tree = buildFileTree([fs('z.md'), fs('aaa/x.ts')]);
    expect(tree[0].name).toBe('aaa');
    expect(tree[0].children.length).toBe(1);
    expect(tree[1].name).toBe('z.md');
  });

  it('strips trailing slashes from paths', () => {
    const tree = buildFileTree([fs('dir/file.ts/')]);
    const dir = tree.find((n) => n.name === 'dir')!;
    expect(dir.children[0].name).toBe('file.ts');
    expect(dir.children[0].file?.path).toBe('dir/file.ts');
  });

  it('skips empty paths', () => {
    expect(buildFileTree([fs(''), fs('/')])).toEqual([]);
  });

  it('keeps file metadata (status, staged) intact', () => {
    const tree = buildFileTree([fs('a.ts', 'A', true)]);
    expect(tree[0].file).toMatchObject({ status: 'A', staged: true });
  });
});

describe('collectFiles', () => {
  it('returns the file when node is a leaf', () => {
    const node: FileTreeNode = { name: 'a', path: 'a', file: fs('a'), children: [] };
    expect(collectFiles(node)).toEqual([fs('a')]);
  });

  it('returns empty array for an empty folder node', () => {
    const node: FileTreeNode = { name: 'empty', path: 'empty', file: null, children: [] };
    expect(collectFiles(node)).toEqual([]);
  });

  it('flattens all leaves under a folder (mixed tracked + untracked)', () => {
    const tree = buildFileTree([
      fs('src/a.ts', 'M'),
      fs('src/b.ts', '?'),
      fs('src/sub/c.ts', 'A'),
    ]);
    const srcFolder = tree.find((n) => n.name === 'src')!;
    const collected = collectFiles(srcFolder);
    const paths = collected.map((c) => c.path).sort();
    expect(paths).toEqual(['src/a.ts', 'src/b.ts', 'src/sub/c.ts']);
    const statuses = new Set(collected.map((c) => c.status));
    expect(statuses).toEqual(new Set(['M', '?', 'A']));
  });

  it('does not double-count when a folder also has its own .file (edge case)', () => {
    const tree = buildFileTree([fs('foo'), fs('foo/bar.ts')]);
    const fooNode = tree.find((n) => n.name === 'foo')!;
    expect(collectFiles(fooNode)).toEqual([fooNode.file]);
  });
});

describe('flattenTree', () => {
  it('flattens all rows when nothing is collapsed', () => {
    const tree = buildFileTree([fs('src/a.ts'), fs('src/sub/c.ts'), fs('readme.md')]);
    const rows = flattenTree(tree, new Set());
    // Папки сортируются перед файлами: src → src/sub → src/sub/c.ts → src/a.ts → readme.md
    expect(rows.map((r) => r.node.path)).toEqual([
      'src', 'src/sub', 'src/sub/c.ts', 'src/a.ts', 'readme.md',
    ]);
    expect(rows.find((r) => r.node.path === 'src')!.isDir).toBe(true);
    expect(rows.find((r) => r.node.path === 'readme.md')!.isDir).toBe(false);
  });

  it('assigns increasing depth to nested nodes', () => {
    const tree = buildFileTree([fs('src/sub/c.ts')]);
    const rows = flattenTree(tree, new Set());
    const byPath = Object.fromEntries(rows.map((r) => [r.node.path, r.depth]));
    expect(byPath['src']).toBe(0);
    expect(byPath['src/sub']).toBe(1);
    expect(byPath['src/sub/c.ts']).toBe(2);
  });

  it('hides children of collapsed folders', () => {
    const tree = buildFileTree([fs('src/a.ts'), fs('src/sub/c.ts'), fs('readme.md')]);
    const rows = flattenTree(tree, new Set(['src']));
    expect(rows.map((r) => r.node.path)).toEqual(['src', 'readme.md']);
  });

  it('collapsing a deep folder keeps its siblings visible', () => {
    const tree = buildFileTree([fs('src/a.ts'), fs('src/sub/c.ts')]);
    const rows = flattenTree(tree, new Set(['src/sub']));
    expect(rows.map((r) => r.node.path)).toEqual(['src', 'src/sub', 'src/a.ts']);
  });
});

describe('collectFolderPaths / isFolderNode', () => {
  it('collects every folder path in the tree', () => {
    const tree = buildFileTree([fs('src/a.ts'), fs('src/sub/c.ts'), fs('readme.md')]);
    expect(collectFolderPaths(tree).sort()).toEqual(['src', 'src/sub']);
  });

  it('isFolderNode distinguishes folders from leaves', () => {
    const tree = buildFileTree([fs('src/a.ts')]);
    const src = tree.find((n) => n.name === 'src')!;
    expect(isFolderNode(src)).toBe(true);
    expect(isFolderNode(src.children[0])).toBe(false);
  });
});
