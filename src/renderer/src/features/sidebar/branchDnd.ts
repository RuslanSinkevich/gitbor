/**
 * DnD-рассчёт нового имени ветки при перетаскивании в папку.
 *
 * @param oldFullName - полное имя ветки (e.g. `feature/a`)
 * @param targetFolderPath - целевая папка (e.g. `archive`, '' для корня)
 * @returns Новое полное имя (e.g. `archive/a`)
 */
export function computeMovedBranchName(oldFullName: string, targetFolderPath: string): string {
  const segments = oldFullName.split('/');
  const leaf = segments[segments.length - 1];
  return targetFolderPath ? `${targetFolderPath}/${leaf}` : leaf;
}

export const BRANCH_DND_TYPE = 'application/x-gitbor-branch';

export interface BranchDndPayload {
  kind: 'branch';
  name: string;
  isLocal: boolean;
}

export function encodeBranchDnd(payload: BranchDndPayload): string {
  return JSON.stringify(payload);
}

export function decodeBranchDnd(raw: string): BranchDndPayload | null {
  try {
    const p = JSON.parse(raw);
    if (p && p.kind === 'branch' && typeof p.name === 'string') return p as BranchDndPayload;
  } catch { /* ignore */ }
  return null;
}
