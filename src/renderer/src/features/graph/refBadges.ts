import type { Commit } from '../../types';

type Ref = Commit['refs'][number];

/**
 * Сгруппированный бейдж рефа. Локальная ветка и её remote-tracking двойники,
 * указывающие на ОДИН коммит (т.е. «с одного места» — в синхроне), сливаются
 * в один бейдж. Это поведение Fork: вместо двух плашек `feature/x` +
 * `origin/feature/x` на одном коммите показывается одна с пометкой, что ветка
 * есть и локально, и на remote'ах.
 */
export interface RefBadge {
  key: string;
  /** Короткий текст на плашке. */
  label: string;
  /** Полные имена всех слитых рефов — для тултипа. */
  fullNames: string[];
  kind: 'branch' | 'remote' | 'tag' | 'head';
  /** Это checked-out ветка (HEAD). */
  isCurrent: boolean;
  /** Есть локальная ветка. */
  hasLocal: boolean;
  /** Remote'ы, на которых ветка в этой же точке (origin, tfs, ...). */
  remotes: string[];
}

interface Group {
  name: string;
  isCurrent: boolean;
  hasLocal: boolean;
  remotes: string[];
  fullNames: string[];
  order: number;
}

/**
 * Отделить имя remote'а от имени ветки в строке вида `origin/feature/x`.
 * Префикс ищем строго по списку известных remote'ов (имя ветки само может
 * содержать слэши), поэтому split по первому `/` тут неверен.
 */
function splitRemote(name: string, remoteNames: string[]): { remote: string; branch: string } | null {
  for (const r of remoteNames) {
    if (name === r) continue;
    if (name.startsWith(r + '/')) return { remote: r, branch: name.slice(r.length + 1) };
  }
  return null;
}

/**
 * Построить плашки рефов для коммита. Локальные ветки и совпадающие
 * remote-tracking ветки сливаются; теги и remote-only ветки остаются
 * отдельными плашками.
 */
export function buildRefBadges(
  refs: Ref[],
  remoteNames: string[],
  currentBranch: string,
): RefBadge[] {
  const groups = new Map<string, Group>();
  const standalone: RefBadge[] = [];
  let order = 0;

  const ensureGroup = (name: string): Group => {
    let g = groups.get(name);
    if (!g) {
      g = { name, isCurrent: false, hasLocal: false, remotes: [], fullNames: [], order: order++ };
      groups.set(name, g);
    }
    return g;
  };

  for (const ref of refs) {
    if (ref.type === 'tag') {
      standalone.push({
        key: `tag:${ref.name}`,
        label: ref.name,
        fullNames: [ref.name],
        kind: 'tag',
        isCurrent: false,
        hasLocal: false,
        remotes: [],
      });
      continue;
    }

    if (ref.type === 'head') {
      // `HEAD -> branch` → имя ветки; detached `HEAD` → отдельная плашка.
      if (ref.name === 'HEAD') {
        standalone.push({
          key: 'head:HEAD',
          label: 'HEAD',
          fullNames: ['HEAD'],
          kind: 'head',
          isCurrent: true,
          hasLocal: false,
          remotes: [],
        });
        continue;
      }
      const g = ensureGroup(ref.name);
      g.isCurrent = true;
      g.hasLocal = true;
      if (!g.fullNames.includes(ref.name)) g.fullNames.push(ref.name);
      continue;
    }

    if (ref.type === 'branch') {
      const g = ensureGroup(ref.name);
      g.hasLocal = true;
      if (ref.name === currentBranch) g.isCurrent = true;
      if (!g.fullNames.includes(ref.name)) g.fullNames.push(ref.name);
      continue;
    }

    // remote
    const parsed = splitRemote(ref.name, remoteNames);
    if (parsed) {
      const g = ensureGroup(parsed.branch);
      if (!g.remotes.includes(parsed.remote)) g.remotes.push(parsed.remote);
      if (!g.fullNames.includes(ref.name)) g.fullNames.push(ref.name);
    } else {
      // Не удалось разобрать (remote не из списка) — показываем как есть.
      standalone.push({
        key: `remote:${ref.name}`,
        label: ref.name,
        fullNames: [ref.name],
        kind: 'remote',
        isCurrent: false,
        hasLocal: false,
        remotes: [],
      });
    }
  }

  const grouped: RefBadge[] = [];
  for (const g of groups.values()) {
    // Группа без локальной ветки (только remote-tracking) — это remote-ветка.
    // Показываем её полным именем `remote/branch`, чтобы не путать с локальной.
    const remoteOnly = !g.hasLocal && g.remotes.length > 0;
    grouped.push({
      key: `grp:${g.name}:${g.order}`,
      label: remoteOnly ? `${g.remotes[0]}/${g.name}` : g.name,
      fullNames: g.fullNames,
      kind: remoteOnly ? 'remote' : (g.isCurrent ? 'head' : 'branch'),
      isCurrent: g.isCurrent,
      hasLocal: g.hasLocal,
      remotes: g.remotes,
    });
  }

  // Текущая ветка — первой, дальше по порядку появления.
  grouped.sort((a, b) => (a.isCurrent === b.isCurrent ? 0 : a.isCurrent ? -1 : 1));

  return [...grouped, ...standalone];
}
