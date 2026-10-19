import { describe, it, expect } from 'vitest';
import { withRemoteTwins } from '../../src/renderer/src/features/sidebar/remoteTwin';
import type { Branch } from '../../src/renderer/src/types';

const b = (name: string, extra: Partial<Branch> = {}): Branch => ({ name, hash: 'h', isCurrent: false, isRemote: false, ...extra });

describe('withRemoteTwins', () => {
  const all = [
    b('backup/old'),
    b('TASK-1'),
    b('TASK-2', { upstream: 'origin/TASK-2' }),
    b('origin/TASK-1', { isRemote: true }),
    b('upstream/TASK-1', { isRemote: true }),
    b('origin/TASK-2', { isRemote: true }),
  ];
  const res = withRemoteTwins(all, ['upstream', 'origin']);

  it('только локальные ветки', () => {
    expect(res.map(x => x.name)).toEqual(['backup/old', 'TASK-1', 'TASK-2']);
  });
  it('нет на сервере — без двойника («только локально»)', () => {
    expect(res[0].remoteTwin).toBeUndefined();
  });
  it('на сервере есть одноимённая — двойник, origin в приоритете', () => {
    expect(res[1].remoteTwin).toBe('origin/TASK-1');
  });
  it('связанной ветке двойник не нужен', () => {
    expect(res[2].remoteTwin).toBeUndefined();
  });
});
