/**
 * Сравнение версий формата `X.Y.Z`. Pre-release/build-суффиксы
 * (`-beta.1`, `+build`) отбрасываются: для авто-обновления достаточно
 * сравнения по числовым компонентам.
 *
 * Возвращает 1 если a > b, -1 если a < b, 0 если равны.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseParts(a);
  const pb = parseParts(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** True, если `remote` строго новее `current`. */
export function isNewerVersion(remote: string, current: string): boolean {
  return compareVersions(remote, current) > 0;
}

function parseParts(v: string): number[] {
  const core = String(v).trim().replace(/^v/i, '').split(/[-+]/)[0];
  return core.split('.').map((s) => Number.parseInt(s, 10) || 0);
}
