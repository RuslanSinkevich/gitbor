import type { Branch } from '../../types';

/**
 * Локальным веткам без upstream проставить `remoteTwin` — одноимённую ветку
 * на сервере (сначала origin). Без этого у такой ветки справа было пусто, и
 * не понять: её нет на сервере или она просто не связана.
 */
export function withRemoteTwins(branches: Branch[], remoteNames: string[]): Branch[] {
  const remoteSet = new Set(branches.filter(b => b.isRemote).map(b => b.name));
  const order = [...remoteNames].sort((x, y) => (x === 'origin' ? -1 : y === 'origin' ? 1 : 0));
  return branches.filter(b => !b.isRemote).map(b => {
    if (b.upstream) return b;
    const twin = order.map(r => `${r}/${b.name}`).find(n => remoteSet.has(n));
    return twin ? { ...b, remoteTwin: twin } : b;
  });
}
