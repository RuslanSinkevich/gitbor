import type { DiffHunk, DiffLine, FileDiff } from '../../types';

/**
 * Файл новый или удалён целиком — одна из сторон сравнения пустая. Раскладывать
 * такой diff в две колонки бессмысленно (половина экрана — штриховка), поэтому
 * все виды (split, весь файл, модалка) рендерят его в одну колонку.
 */
export function isOneSidedDiff(diff: Pick<FileDiff, 'status' | 'hunks'>): boolean {
  if (diff.status === 'added' || diff.status === 'deleted') return true;
  // Страховка на случай, если статус не распознан парсером: смотрим на сами строки.
  let adds = false, removes = false;
  for (const h of diff.hunks) {
    for (const l of h.lines) {
      if (l.type === 'context') return false;
      if (l.type === 'add') adds = true;
      else removes = true;
      if (adds && removes) return false;
    }
  }
  return adds !== removes;
}

/** Плоский список строк всех hunks — для одноколоночного (unified) whole-file вида. */
export function flattenHunkLines(hunks: DiffHunk[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (const h of hunks) for (const l of h.lines) out.push(l);
  return out;
}

/** Метки миникарты для unified-вида: по одной на каждую добавленную/удалённую строку. */
export function buildLineMarks(lines: DiffLine[]): ChangeMark[] {
  const total = lines.length;
  if (total === 0) return [];
  const marks: ChangeMark[] = [];
  for (let i = 0; i < total; i++) {
    const tp = lines[i].type;
    if (tp !== 'context') marks.push({ ratio: i / total, heightRatio: 1 / total, type: tp });
  }
  return marks;
}

export type SideCellType = 'add' | 'remove' | 'context' | 'empty';

export interface SideCell {
  lineNo: number | null;
  content: string;
  type: SideCellType;
}

export interface SideRow {
  left: SideCell;
  right: SideCell;
}

const EMPTY_CELL: SideCell = { lineNo: null, content: '', type: 'empty' };

/**
 * Раскладывает hunks в плоский массив пар-строк {left, right} для side-by-side.
 * Удаления/добавления внутри одного блока выравниваются построчно; если с
 * одной стороны строк меньше — недостающие заполняются пустыми ячейками,
 * чтобы вертикальное выравнивание колонок оставалось корректным.
 *
 * Чистая функция без зависимостей от React — отдельно покрывается unit-тестами
 * и переиспользуется как hunk-split, так и whole-file видом.
 */
export function buildSideRows(hunks: DiffHunk[]): SideRow[] {
  const rows: SideRow[] = [];
  const removes: DiffLine[] = [];
  const adds: DiffLine[] = [];

  const flushPairs = () => {
    const max = Math.max(removes.length, adds.length);
    for (let i = 0; i < max; i++) {
      const left: SideCell = i < removes.length
        ? { lineNo: removes[i].oldLineNo, content: removes[i].content, type: 'remove' }
        : EMPTY_CELL;
      const right: SideCell = i < adds.length
        ? { lineNo: adds[i].newLineNo, content: adds[i].content, type: 'add' }
        : EMPTY_CELL;
      rows.push({ left, right });
    }
    removes.length = 0;
    adds.length = 0;
  };

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        flushPairs();
        rows.push({
          left: { lineNo: line.oldLineNo, content: line.content, type: 'context' },
          right: { lineNo: line.newLineNo, content: line.content, type: 'context' },
        });
      } else if (line.type === 'remove') {
        removes.push(line);
      } else {
        adds.push(line);
      }
    }
    // Граница hunk — закрываем накопленные пары, чтобы удаления одного блока
    // не паровались с добавлениями следующего (per-hunk семантика).
    flushPairs();
  }

  return rows;
}

/** Длина самой длинной строки контента среди всех ячеек (для ширины колонок). */
export function maxRowContentLength(rows: SideRow[]): number {
  let max = 0;
  for (const r of rows) {
    if (r.left.content.length > max) max = r.left.content.length;
    if (r.right.content.length > max) max = r.right.content.length;
  }
  return max;
}

export type RowChange = 'add' | 'remove' | 'modify' | 'none';

/**
 * Классифицирует ряд для миникарты-обзора: удаление слева + добавление справа
 * = изменённая строка (`modify`); только добавление/удаление = `add`/`remove`;
 * контекст без изменений = `none`.
 */
export function rowChange(row: SideRow): RowChange {
  const removed = row.left.type === 'remove';
  const added = row.right.type === 'add';
  if (removed && added) return 'modify';
  if (added) return 'add';
  if (removed) return 'remove';
  return 'none';
}

export interface ChangeMark {
  /** Позиция ряда в диапазоне [0..1) относительно всего файла. */
  ratio: number;
  /** Высота изменённого ряда/DOM-блока в долях полного контента. */
  heightRatio?: number;
  type: Exclude<RowChange, 'none'>;
}

/** Собирает метки изменений для миникарты: по одной на каждый изменённый ряд. */
export function buildChangeMarks(rows: SideRow[]): ChangeMark[] {
  const total = rows.length;
  if (total === 0) return [];
  const marks: ChangeMark[] = [];
  for (let i = 0; i < total; i++) {
    const c = rowChange(rows[i]);
    if (c !== 'none') marks.push({ ratio: i / total, heightRatio: 1 / total, type: c });
  }
  return marks;
}
