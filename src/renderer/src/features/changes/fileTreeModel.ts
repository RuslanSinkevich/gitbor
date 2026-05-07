import type { FileStatus } from '../../types';

/* ─── Tree node types ─── */

export interface FileTreeNode {
  name: string;
  path: string;
  file: FileStatus | null;
  children: FileTreeNode[];
}

/* ─── Build ─── */

export function buildFileTree(files: FileStatus[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const file of files) {
    const normalizedPath = file.path.replace(/\/+$/, '');
    const parts = normalizedPath.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      let existing = current.find((n) => n.name === name);
      if (!existing) {
        existing = {
          name,
          path: parts.slice(0, i + 1).join('/'),
          file: isFile ? { ...file, path: normalizedPath } : null,
          children: [],
        };
        current.push(existing);
      }
      if (isFile) existing.file = { ...file, path: normalizedPath };
      current = existing.children;
    }
  }
  return sortFileTree(root);
}

function sortFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  const sortedChildren = nodes.map((node) => ({
    ...node,
    children: sortFileTree(node.children),
  }));

  return sortedChildren.sort((a, b) => {
    const aIsFolder = a.children.length > 0 && !a.file;
    const bIsFolder = b.children.length > 0 && !b.file;
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}

export function collectFiles(node: FileTreeNode): FileStatus[] {
  if (node.file) return [node.file];
  return node.children.flatMap(collectFiles);
}
