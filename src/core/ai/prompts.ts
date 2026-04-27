/**
 * Шаблоны промптов. Держим в отдельном файле чтобы редактировать их без
 * изменений остального кода и чтобы пользователь мог переопределить из
 * настроек, не уходя глубже в исходники.
 */

import type { CommitLanguage } from './types';

/** Максимум символов diff'а, которые отправляем в LLM. Урезаем всё лишнее. */
export const MAX_DIFF_CHARS = 6_000;

const BASE_RULES = [
  'You write concise, meaningful git commit messages.',
  'Rules:',
  '- Subject line: imperative mood, lowercase start, no trailing period, ≤72 chars.',
  '- Optional body after a blank line: wrap at 72 chars, explain "why" not "what".',
  '- No backticks, no markdown, no prefixes like "feat:" unless the diff clearly uses Conventional Commits already.',
  '- Respond with ONLY the commit message text. Do not add explanations or quotes.',
];

/**
 * Системный промпт с учётом выбранного языка commit message. `auto` — не
 * добавляем инструкцию про язык (пусть модель решает сама).
 */
export function buildCommitSystemPrompt(language: CommitLanguage = 'auto'): string {
  const rules = [...BASE_RULES];
  const langLine = commitLanguageInstruction(language);
  if (langLine) rules.push(langLine);
  return rules.join('\n');
}

/** Для обратной совместимости с тестами и местами, где язык не важен. */
export const DEFAULT_COMMIT_SYSTEM_PROMPT = buildCommitSystemPrompt('auto');

/**
 * Собрать user-промпт из diff. Урезаем по длине, чтобы влезло в контекст.
 * Дублируем требование к языку здесь — локальные и корпоративные модели
 * иногда «забывают» system-инструкции, особенно при мало-параметровой
 * квантизации.
 */
export function buildCommitUserPrompt(diff: string, language: CommitLanguage = 'auto'): string {
  const trimmed = truncateDiff(diff, MAX_DIFF_CHARS);
  const langNote = userLanguageNote(language);
  const header = langNote
    ? `Here is the staged git diff. Write the commit message. ${langNote}`
    : 'Here is the staged git diff. Write the commit message.';
  return `${header}\n\n${trimmed}`;
}

function commitLanguageInstruction(language: CommitLanguage): string | null {
  switch (language) {
    case 'en':
      return '- LANGUAGE: Write the ENTIRE commit message in English. Do not mix languages.';
    case 'ru':
      return [
        '- ЯЗЫК: Пиши коммит-сообщение ПОЛНОСТЬЮ на русском языке.',
        '- LANGUAGE: Write the ENTIRE commit message in Russian. Do not mix languages.',
        '- Keep code identifiers, file paths and English technical terms (API, git, merge, hook, diff) untranslated.',
      ].join('\n');
    case 'auto':
    default:
      return null;
  }
}

function userLanguageNote(language: CommitLanguage): string | null {
  switch (language) {
    case 'en':
      return 'Respond in English only.';
    case 'ru':
      return 'Ответ дай на русском языке. Respond in Russian only.';
    case 'auto':
    default:
      return null;
  }
}

function truncateDiff(diff: string, limit: number): string {
  if (diff.length <= limit) return diff;
  const head = diff.slice(0, Math.floor(limit * 0.7));
  const tail = diff.slice(-Math.floor(limit * 0.2));
  return `${head}\n\n… [diff truncated, ${diff.length - limit} chars omitted] …\n\n${tail}`;
}
