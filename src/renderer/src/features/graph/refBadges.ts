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
  /** Канонический полный путь ветки (без префикса remote) — первая строка тултипа. */
  fullName: string;
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
 *
 * Сначала пробуем по списку известных remote'ов. Если список ещё не загружен
 * (async), используем фолбэк: для ref типа remote, пришедшего из
 * `refs/remotes/<remote>/<branch>`, remote — это ВСЕГДА первый сегмент
 * (имя remote'а не содержит слэшей). Поэтому слияние local+remote и короткая
 * подпись не зависят от того, успел ли прийти `remoteNames`.
 */
function splitRemote(name: string, remoteNames: string[]): { remote: string; branch: string } | null {
  for (const r of remoteNames) {
    if (name === r) continue;
    if (name.startsWith(r + '/')) return { remote: r, branch: name.slice(r.length + 1) };
  }
  const slash = name.indexOf('/');
  if (slash > 0 && slash < name.length - 1) {
    return { remote: name.slice(0, slash), branch: name.slice(slash + 1) };
  }
  return null;
}

function segments(name: string): string[] {
  return name.split('/').filter(Boolean);
}

/**
 * Короткие подписи для набора имён веток с разрешением коллизий хвостов.
 *
 * Базово подпись — последний сегмент (`feature/SinkevichRN/NRGIND-42277` →
 * `NRGIND-42277`). Если хвосты совпадают, наращиваем количество сегментов с
 * конца, пока подпись не станет уникальной. Полный путь (самый длинный) не
 * раскрываем: если уникальности не добиться короче — добавляем суффикс `·N`.
 *
 * Считается ЛОКАЛЬНО по бейджам одного коммита, без async-данных — поэтому
 * подписи детерминированы и не «мигают».
 */
function computeShortLabels(names: string[]): string[] {
  const n = names.length;
  if (n === 0) return [];
  const segs = names.map(segments);
  const result: (string | null)[] = new Array(n).fill(null);
  const maxLen = Math.max(...segs.map(s => s.length));
  // Наращиваем хвост до maxLen-1 сегментов (не до полного самого длинного пути).
  // Минимум 1 — иначе односегментные имена (`main`) не получили бы подпись.
  const maxK = Math.max(1, maxLen - 1);

  for (let k = 1; k <= maxK; k++) {
    const cand = segs.map(s => s.slice(Math.max(0, s.length - k)).join('/'));
    const counts = new Map<string, number>();
    for (const c of cand) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (let i = 0; i < n; i++) {
      if (result[i] === null && counts.get(cand[i]) === 1) result[i] = cand[i];
    }
  }

  let dup = 1;
  for (let i = 0; i < n; i++) {
    if (result[i] === null) {
      const tail = segs[i].at(-1) ?? names[i];
      result[i] = `${tail} ·${dup++}`;
    }
  }
  return result as string[];
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
        fullName: ref.name,
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
          fullName: 'HEAD',
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
        fullName: ref.name,
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
    const remoteOnly = !g.hasLocal && g.remotes.length > 0;
    grouped.push({
      key: `grp:${g.name}:${g.order}`,
      // Временно кладём полное имя ветки; короткую подпись проставим ниже.
      label: g.name,
      fullName: g.name,
      fullNames: g.fullNames,
      kind: remoteOnly ? 'remote' : (g.isCurrent ? 'head' : 'branch'),
      isCurrent: g.isCurrent,
      hasLocal: g.hasLocal,
      remotes: g.remotes,
    });
  }

  // Текущая ветка — первой, дальше по порядку появления.
  grouped.sort((a, b) => (a.isCurrent === b.isCurrent ? 0 : a.isCurrent ? -1 : 1));

  const ordered = [...grouped, ...standalone];

  // Короткие подписи: последний сегмент имени ветки + разрешение коллизий.
  // Теги и detached HEAD оставляем как есть.
  const shortenable = ordered.filter(b => b.kind !== 'tag' && !(b.kind === 'head' && b.label === 'HEAD'));
  const labels = computeShortLabels(shortenable.map(b => b.label));
  shortenable.forEach((b, i) => { b.label = labels[i]; });

  return ordered;
}
