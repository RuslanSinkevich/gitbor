import type { DiffHunk, DiffLine } from '../../types';

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
