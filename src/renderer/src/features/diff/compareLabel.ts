const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf899d15d4cef8de1';

/** Короткая ревизия: срезаем суффиксы `^`, `^1`, `~N` и берём 7 символов хеша. */
export function shortRev(rev: string): string {
  const base = rev.replace(/[\^~].*$/, '');
  return base.length > 7 ? base.slice(0, 7) : base;
}

/** true, если `fromHash` — это первый родитель `toHash` (`<to>^` / `<to>^1`). */
export function isParentOf(fromHash: string, toHash: string): boolean {
  return fromHash === `${toHash}^` || fromHash === `${toHash}^1`;
}

export interface CompareLabelStrings {
  /** «Изменения относительно предыдущего коммита». */
  vsPrevious: string;
  /** «Изменения с момента создания» (сравнение с пустым деревом). */
  sinceCreation: string;
  /** «Изменения относительно рабочей копии» (сравнение коммита с WORKING). */
  vsWorking: string;
  /** Шаблон `{from} → {to}` для произвольного диапазона. */
  range: (from: string, to: string) => string;
}

/**
 * Человекочитаемый заголовок сравнения вместо сырых хешей `abc..abc`.
 * Частые случаи (коммит против родителя, против пустого дерева, против рабочей
 * копии) проговариваются словами; произвольный диапазон — короткие хеши со
 * стрелкой.
 */
export function buildCompareLabel(fromHash: string, toHash: string, str: CompareLabelStrings): string {
  if (toHash === 'WORKING') return str.vsWorking;
  if (isParentOf(fromHash, toHash)) return str.vsPrevious;
  if (fromHash === EMPTY_TREE || fromHash.startsWith(`${EMPTY_TREE}`)) return str.sinceCreation;
  return str.range(shortRev(fromHash), shortRev(toHash));
}
