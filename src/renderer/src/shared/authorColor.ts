/**
 * Deterministic author "identicon" colors.
 *
 * Given an author's email (preferred) or display name, produce a stable
 * `{bg, fg, initials}` triple used by `AuthorAvatar`. The same input always
 * maps to the same hue, so a contributor stays visually consistent across
 * the graph, commit details and any other surface.
 *
 * The hash is a small djb2 variant — no crypto, just enough scatter to
 * keep neighbouring authors apart. Hue is `hash % 360`; saturation and
 * lightness are fixed to keep contrast predictable against dark themes.
 */

export interface AuthorVisual {
  /** HSL background color string ready for inline-style. */
  bg: string;
  /** Foreground (text) color with sufficient contrast on `bg`. */
  fg: string;
  /** 1-2 character initial label, uppercased. */
  initials: string;
}

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h | 0;
  }
  return Math.abs(h);
}

/**
 * Extract up to two letter-initials from `name`, falling back to `email`'s
 * local part when name is empty or contains no letters. Supports Cyrillic
 * and any other Unicode letters via the `\p{L}` class.
 */
function computeInitials(name: string | undefined, email: string): string {
  const cleanName = (name || '').trim();
  if (cleanName) {
    const words = cleanName.split(/\s+/).filter(w => /\p{L}/u.test(w));
    if (words.length >= 2) {
      const a = firstLetter(words[0]);
      const b = firstLetter(words[1]);
      if (a && b) return (a + b).toUpperCase();
      if (a) return a.toUpperCase();
    }
    if (words.length === 1) {
      const w = words[0];
      const letters = w.match(/\p{L}/gu);
      if (letters && letters.length >= 2) return (letters[0] + letters[1]).toUpperCase();
      if (letters && letters.length === 1) return letters[0].toUpperCase();
    }
  }
  const localPart = (email.split('@')[0] || '');
  const letters = localPart.match(/\p{L}/gu);
  if (letters && letters.length >= 2) return (letters[0] + letters[1]).toUpperCase();
  if (letters && letters.length === 1) return letters[0].toUpperCase();
  return '?';
}

function firstLetter(word: string): string | null {
  const m = word.match(/\p{L}/u);
  return m ? m[0] : null;
}

/**
 * Deterministic visual representation for an author.
 * Same `email` (case-insensitive) → same `bg` and `fg` every call.
 * If both `email` and `name` are empty, returns a neutral grey avatar
 * with `?` initials.
 *
 * Палитра намеренно построена не «hash % 360», а через золотое сечение
 * (0.61803...), чтобы соседние по хэшу значения разлетались по кругу
 * максимально далеко. На практике это убирает «розовую стену», когда
 * у команды много email'ов с похожим хэшем и они все падают в один
 * 30°-сектор. Saturation/lightness слегка варьируются для дополнительной
 * различимости, но в безопасном диапазоне читаемого контраста на тёмной
 * теме.
 */
const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;

export function colorForAuthor(email: string, name?: string): AuthorVisual {
  const key = (email || name || '').trim().toLowerCase();
  if (!key) {
    return { bg: 'hsl(0, 0%, 50%)', fg: '#ffffff', initials: '?' };
  }
  const h = hashString(key);
  // Hue: золотое сечение даёт max-spread по кругу для последовательных хэшей.
  const hue = Math.floor(((h % 1000000) * GOLDEN_RATIO_CONJUGATE) % 1 * 360);
  // Saturation 60-85% — насыщенные «брендовые» цвета, без пастели.
  const sat = 60 + (h >> 8) % 26;
  // Lightness 42-58% — гарантирует контраст и для светлых, и для тёмных тем.
  const lit = 42 + (h >> 16) % 17;
  const bg = `hsl(${hue}, ${sat}%, ${lit}%)`;
  const fg = lit > 55 ? '#1a1a1a' : '#ffffff';
  return { bg, fg, initials: computeInitials(name, email) };
}
