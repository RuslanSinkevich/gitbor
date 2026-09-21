/**
 * Папки-предки в координатах `buildBranchTree`.
 * `stripPrefix` как у remote-дерева (`origin/`) — пути совпадут с `node.fullPath`
 * (включая исторический `origin//feature` из склейки prefix + '/' + segment).
 */
export function treeAncestorPaths(branchName: string, stripPrefix = ''): string[] {
  if (!branchName) return [];
  const name = stripPrefix ? branchName.replace(stripPrefix, '') : branchName;
  const parts = name.split('/').filter(Boolean);
  if (parts.length < 2) return [];
  const paths: string[] = [];
  let currentPath = stripPrefix;
  for (let i = 0; i < parts.length - 1; i++) {
    currentPath = currentPath ? currentPath + '/' + parts[i] : parts[i];
    paths.push(currentPath);
  }
  return paths;
}

/** Папки-предки `a/b/c` → `['a', 'a/b']`. Лист без `/` — пусто. */
export function ancestorFolderPaths(branchName: string): string[] {
  return treeAncestorPaths(branchName, '');
}

/**
 * Имя remote из полного `origin/feature/x`. Сначала самые длинные имена
 * (чтобы `my-origin` не съел `origin`), иначе первый сегмент до `/`.
 */
export function matchRemoteName(
  fullName: string,
  remoteNames: string[],
): { remote: string; prefix: string } | null {
  const sorted = [...remoteNames].sort((a, b) => b.length - a.length);
  for (const r of sorted) {
    if (fullName.startsWith(r + '/')) return { remote: r, prefix: r + '/' };
  }
  const slash = fullName.indexOf('/');
  if (slash > 0) return { remote: fullName.slice(0, slash), prefix: fullName.slice(0, slash + 1) };
  return null;
}
