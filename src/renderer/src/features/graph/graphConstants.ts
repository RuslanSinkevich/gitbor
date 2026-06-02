export const ROW_HEIGHT = 28;
/*
 * Расстояние между дорожками графа. Уменьшено 14 → 11 (Fork-style): ветки
 * визуально «прижимаются» друг к другу, граф занимает заметно меньше места по
 * ширине. Вся геометрия (узлы, кривые, merge-линии) выводится из colX(), так
 * что менять достаточно здесь — алгоритм раскладки и maxColumns не затронуты.
 */
export const COL_WIDTH = 11;
export const LEFT_PAD = 16;
export const NODE_RADIUS = 4.5;
export const MERGE_RADIUS = 4;
export const OVERSCAN = 30;
export const DESC_PAD = 16;

export function colX(col: number): number {
  return LEFT_PAD + col * COL_WIDTH;
}

export function rowY(row: number): number {
  return row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function formatCommitDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
