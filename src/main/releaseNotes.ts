/**
 * Заметки «что нового» из `latest.yml` (поле `releaseNotes`).
 *
 * Источник — `build/release-notes.md`: electron-builder сам подхватывает его
 * из build resources и кладёт текст в `latest.yml` рядом с установщиком в
 * бакете. Так заметки едут вместе с обновлением — без сайта и отдельного API.
 *
 * Формат файла — два блока, разделённые HTML-комментариями (в markdown они
 * невидимы), пункты — строки с `- `:
 *
 *     <!-- ru -->
 *     - Короткий пункт
 *     <!-- en -->
 *     - Short item
 */
export type ReleaseNotes = { ru: string[]; en: string[] };

/**
 * `info.releaseNotes` от electron-updater: строка, либо массив
 * `{ version, note }` (при fullChangelog), либо null. HTML-провайдеры могут
 * отдать текст с тегами — снимаем их.
 */
export function parseReleaseNotes(raw: unknown): ReleaseNotes | undefined {
  let text: string;
  if (typeof raw === 'string') {
    text = raw;
  } else if (Array.isArray(raw)) {
    text = raw
      .map((r) => (r && typeof r === 'object' && typeof (r as { note?: unknown }).note === 'string' ? (r as { note: string }).note : ''))
      .join('\n');
  } else {
    return undefined;
  }

  const notes: ReleaseNotes = { ru: [], en: [] };
  let lang: keyof ReleaseNotes | null = null;
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    const marker = /^<!--\s*(ru|en)\s*-->$/i.exec(line);
    if (marker) {
      lang = marker[1].toLowerCase() as keyof ReleaseNotes;
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (!bullet) continue;
    const item = bullet[1].replace(/<[^>]+>/g, '').trim();
    if (!item) continue;
    // Без маркеров языка — считаем текст русским (основная аудитория).
    notes[lang ?? 'ru'].push(item);
  }
  if (notes.ru.length === 0 && notes.en.length === 0) return undefined;
  return notes;
}
