/** Типы Conventional Commits в порядке частоты использования. */
export const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'docs',
  'refactor',
  'style',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

export type ConventionalType = (typeof CONVENTIONAL_TYPES)[number];

/** Тип по умолчанию, когда пользователь не выбрал ничего. */
export const DEFAULT_CONVENTIONAL_TYPE: ConventionalType = 'feat';

const CONVENTIONAL_HEADER_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9_./-]+\))?!?: .+/;

// Разбор заголовка на части: type, scope (со скобками), `!`, описание.
const HEADER_PARTS_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9_./-]+\))?(!)?:\s*(.*)$/i;

/** First line passes a conventional-commits commit-msg hook. */
export function isConventionalCommitSubject(subject: string): boolean {
  const line = subject.trim();
  if (!line) return false;
  if (/^Merge/i.test(line) || /^Revert/i.test(line)) return true;
  return CONVENTIONAL_HEADER_RE.test(line);
}

/** Извлечь тип из заголовка (`feat(scope): ...` → `feat`), иначе null. */
export function parseConventionalType(subject: string): ConventionalType | null {
  const m = subject.trim().match(HEADER_PARTS_RE);
  if (!m) return null;
  const type = m[1].toLowerCase();
  return (CONVENTIONAL_TYPES as readonly string[]).includes(type)
    ? (type as ConventionalType)
    : null;
}

/**
 * Применить выбранный тип к заголовку. Если префикс уже есть — заменяем тип,
 * сохраняя scope/`!`/описание. Если нет — добавляем `type: ` в начало,
 * не трогая текст пользователя.
 */
export function applyConventionalType(subject: string, type: ConventionalType): string {
  const m = subject.match(HEADER_PARTS_RE);
  if (m) {
    const scope = m[2] ?? '';
    const bang = m[3] ?? '';
    const rest = m[4] ?? '';
    return `${type}${scope}${bang}: ${rest}`;
  }
  const trimmedStart = subject.replace(/^\s+/, '');
  return `${type}: ${trimmedStart}`;
}

/**
 * Гарантировать корректный Conventional-заголовок: если он уже валиден —
 * вернуть как есть, иначе добавить `defaultType: ` в начало. Так коммит не
 * блокируется, а пользователю не нужно угадывать формат (поведение в духе Fork).
 */
export function ensureConventionalSubject(
  subject: string,
  defaultType: ConventionalType = DEFAULT_CONVENTIONAL_TYPE,
): string {
  const line = subject.trim();
  if (isConventionalCommitSubject(line)) return line;
  if (!line) return line;
  return `${defaultType}: ${line}`;
}
