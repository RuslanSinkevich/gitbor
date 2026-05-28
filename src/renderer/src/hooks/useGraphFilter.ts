import { useMemo } from 'react';
import { computeGraphLayout } from '@core/git/GraphLayout';
import type { Branch, Commit, GraphNode, MergeLink } from '../types';

/**
 * Результат фильтрации: новый layout, отфильтрованные коммиты и метаданные
 * для UI-баннера. computeGraphLayout сейчас возвращает `mergeLinks: []`
 * (поле задумано на будущее), но пробрасываем наружу как есть.
 */
interface GraphFilterResult {
  /** Отфильтрованный список коммитов (после применения solo/hide). */
  commits: Commit[];
  nodes: GraphNode[];
  maxColumns: number;
  mergeLinks: MergeLink[];
  /**
   * Активный режим: solo переопределяет hide. Renderer показывает баннер
   * в соответствующем стиле и кнопку «Сбросить».
   */
  mode: 'solo' | 'hide' | 'none';
  /** Сколько коммитов осталось после фильтра. Для баннера и edge-case `0`. */
  totalKept: number;
  /** Сколько коммитов было до фильтра. Подсказка в баннере. */
  totalAll: number;
}

/**
 * Единая точка фильтрации графа на стороне renderer'а: Solo и Hide.
 *
 * Solo: BFS от tip'а выбранной ветки по предкам → оставляем только
 * достижимые коммиты. Игнорирует hidden — solo жёстче.
 *
 * Hide: BFS от tips всех **не**-hidden локальных веток → оставляем
 * `visibleReachable`, остальные коммиты убираем. Если коммит достижим
 * хотя бы из одной не-скрытой ветки — он остаётся. Это симметрично Solo,
 * но «инвертированно»: показываем всё, кроме того, что достижимо
 * только из скрытых веток.
 *
 * Edge cases:
 *   - все локальные ветки скрыты → пустой список + mode='hide' с баннером
 *     «всё скрыто» (рендерится в CommitsView).
 *   - HEAD скрыт — HEAD-коммит остаётся в visibleReachable, если он
 *     достижим из любой другой ветки. Если нет — он исчезает (это
 *     корректное поведение: юзер явно сказал «спрячь эту ветку»).
 *   - soloBranch указывает на скрытую ветку — solo выигрывает, hide
 *     эту ветку «расхайдит» на время solo (это естественнее, чем
 *     показать пустой граф).
 *
 * Перерасчёт layout: `computeGraphLayout(filtered)` — алгоритм быстрый
 * (O(commits * cols), 10-50ms на 10k коммитов в типичных репо), кешируем
 * только по identity входного массива через useMemo. Кэш WeakMap'ов в
 * CommitGraph сам подхватит новый identity nodes/commits и пересчитает
 * branch paths/circles.
 */
export function useGraphFilter(
  commits: Commit[],
  branches: Branch[],
  soloBranch: string | null,
  hidden: Set<string>,
): GraphFilterResult {
  return useMemo(() => {
    const totalAll = commits.length;

    // Build parents map один раз. commits.parents — short SHA не бывает,
    // в строке хранятся полные хеши родителей; используем как есть.
    const indexByHash = new Map<string, number>();
    for (let i = 0; i < commits.length; i++) indexByHash.set(commits[i].hash, i);

    const localBranches = branches.filter(b => !b.isRemote);

    // ── Solo: BFS от одной ветки ──
    if (soloBranch) {
      const tip = localBranches.find(b => b.name === soloBranch);
      if (!tip) {
        // Ветка исчезла (удалена/переименована) — не фильтруем, отдаём как есть.
        // Родитель снимет soloBranch через useEffect, если хочет.
        return packResult(commits, 'none', totalAll, totalAll);
      }
      const keep = bfsReachable([tip.hash], indexByHash, commits);
      const filtered = commits.filter(c => keep.has(c.hash));
      return packResult(filtered, 'solo', filtered.length, totalAll);
    }

    // ── Hide: BFS от всех НЕ-скрытых локальных веток ──
    if (hidden.size > 0 && localBranches.length > 0) {
      const visibleTips: string[] = [];
      for (const b of localBranches) {
        if (!hidden.has(b.name)) visibleTips.push(b.hash);
      }
      if (visibleTips.length === 0) {
        // Все ветки скрыты — пустой граф. CommitsView отрисует баннер.
        return {
          commits: [],
          nodes: [],
          maxColumns: 0,
          mergeLinks: [],
          mode: 'hide',
          totalKept: 0,
          totalAll,
        };
      }
      const keep = bfsReachable(visibleTips, indexByHash, commits);
      const filtered = commits.filter(c => keep.has(c.hash));
      return packResult(filtered, 'hide', filtered.length, totalAll);
    }

    return packResult(commits, 'none', totalAll, totalAll);
  }, [commits, branches, soloBranch, hidden]);
}

function packResult(
  filtered: Commit[],
  mode: 'solo' | 'hide' | 'none',
  totalKept: number,
  totalAll: number,
): GraphFilterResult {
  if (mode === 'none') {
    /* Layout не пересчитываем — оставляем серверный (`state.graphLayout`)
       для совместимости. Но useGraphFilter всегда возвращает СВОЙ layout,
       чтобы CommitsView подавал в CommitGraph один источник правды.
       Перерасчёт O(n) дешёвый, но удобнее не «прыгать» между двумя ветками. */
  }
  const layout = computeGraphLayout(filtered);
  return {
    commits: filtered,
    nodes: layout.nodes,
    maxColumns: layout.maxColumns,
    mergeLinks: layout.mergeLinks ?? [],
    mode,
    totalKept,
    totalAll,
  };
}

/**
 * BFS по предкам от набора tip-хешей. Возвращает множество достижимых
 * полных SHA. Ходим только по коммитам, которые есть в `commits` —
 * предки за пределами загруженного среза игнорируем (это OK: они там
 * за нижней границей видимости графа).
 */
function bfsReachable(
  startHashes: string[],
  indexByHash: Map<string, number>,
  commits: Commit[],
): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const h of startHashes) {
    if (h && !seen.has(h)) {
      seen.add(h);
      queue.push(h);
    }
  }
  while (queue.length > 0) {
    const hash = queue.shift()!;
    const idx = indexByHash.get(hash);
    if (idx === undefined) continue;
    for (const p of commits[idx].parents) {
      if (!seen.has(p)) {
        seen.add(p);
        queue.push(p);
      }
    }
  }
  return seen;
}
