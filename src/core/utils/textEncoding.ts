/**
 * Декодирование byte-стрима из git в JS-строку с попыткой угадать
 * кодировку исходного файла. Git отдаёт содержимое файлов как есть —
 * байт-в-байт, поэтому если файл сохранён, например, в Windows-1251
 * (типичный legacy на русской Windows: старые .sql, .cs, .pas), то
 * наивное `Buffer.toString('utf8')` превращает кириллицу в кракозябры.
 *
 * Стратегия (от самого надёжного к наиболее частому fallback):
 *   1. UTF-8/16 BOM — однозначный маркер, режем и декодируем.
 *   2. Строгий UTF-8 (fatal). Чисто ASCII-файл тоже валиден как UTF-8.
 *   3. Не прошёл — пробуем CP1251 (Windows Cyrillic).
 *   4. CP1251 даёт подозрительно много контрольных символов —
 *      пробуем CP866 (DOS Cyrillic).
 *
 * Heuristics ограничены теми кодировками, которые реально встречаются
 * в смешанных репозиториях: ASCII, UTF-8, CP1251, CP866. Это покрывает
 * 99% реальных кейсов и не тащит в проект iconv-lite.
 */

const UTF8_BOM = [0xEF, 0xBB, 0xBF];
const UTF16_LE_BOM = [0xFF, 0xFE];
const UTF16_BE_BOM = [0xFE, 0xFF];

function startsWith(buf: Buffer, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

/**
 * Если результат декодирования содержит много управляющих символов
 * (вне ASCII printable, кроме \t/\n/\r) — почти наверняка кодировка
 * угадана не та (например, CP1251 для CP866-данных).
 */
function looksLikeMojibake(s: string): boolean {
  if (s.length === 0) return false;
  let bad = 0;
  const sample = s.length > 4096 ? s.slice(0, 4096) : s;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) bad++;
    else if (code === 0xFFFD) bad++;
  }
  return bad / sample.length > 0.02;
}

/**
 * Декодирует bytes diff/file-output из git, пытаясь угадать кодировку
 * исходного файла. Возвращает уже готовую JS-строку.
 *
 * Поведение:
 *   - чистый ASCII / валидный UTF-8 → utf-8;
 *   - BOM (UTF-8/UTF-16 LE/BE) → соответствующая кодировка;
 *   - иначе пробуем CP1251 → CP866.
 */
export function decodeGitText(buf: Buffer): string {
  if (buf.length === 0) return '';

  if (startsWith(buf, UTF8_BOM)) {
    return new TextDecoder('utf-8').decode(buf.subarray(UTF8_BOM.length));
  }
  if (startsWith(buf, UTF16_LE_BOM)) {
    return new TextDecoder('utf-16le').decode(buf.subarray(UTF16_LE_BOM.length));
  }
  if (startsWith(buf, UTF16_BE_BOM)) {
    return new TextDecoder('utf-16be').decode(buf.subarray(UTF16_BE_BOM.length));
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Не валидный UTF-8 — почти наверняка legacy-кодировка.
  }

  const cp1251 = new TextDecoder('windows-1251').decode(buf);
  if (!looksLikeMojibake(cp1251)) return cp1251;

  // CP1251 даёт мусор — пробуем CP866 (DOS русский).
  try {
    const cp866 = new TextDecoder('ibm866').decode(buf);
    if (!looksLikeMojibake(cp866)) return cp866;
  } catch {
    // ibm866 может отсутствовать в build'е без full ICU — игнорируем.
  }

  return cp1251;
}
