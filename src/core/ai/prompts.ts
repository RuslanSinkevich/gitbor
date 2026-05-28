/**
 * Шаблоны промптов. Держим в отдельном файле чтобы редактировать их без
 * изменений остального кода и чтобы пользователь мог переопределить из
 * настроек, не уходя глубже в исходники.
 *
 * Defaults — на английском (см. DEFAULT_PROMPTS): LLM-модели (включая
 * локальные Qwen / Llama / YandexGPT) делают reasoning лучше на
 * английском. Язык ответа дописывается через `resolvePrompt(id, cfg)`
 * на основе `cfg.aiResponseLanguage`.
 */

import type { AiProviderConfig, CommitLanguage, PromptId } from './types';

/** Максимум символов diff'а, которые отправляем в LLM. Урезаем всё лишнее. */
export const MAX_DIFF_CHARS = 6_000;

/**
 * Дефолтные тексты промптов для всех AI-фич. На этапе AI Settings Redesign
 * реально заполнен только `commitMessage` — остальные ID имеют осмысленные
 * placeholder-промпты с TODO-комментарием, чтобы:
 *   1. PromptId-тип был ограничен ровно этими ключами в одном месте;
 *   2. PromptsSection в UI рендерил все textareas сразу (даже если фича
 *      ещё не подключена);
 *   3. при появлении соответствующего AiService-метода ничего в этой
 *      таблице добавлять не пришлось — TODO заменить готовым промптом.
 *
 * stashName **всегда** на английском (это git-имя, не для пользователя),
 * см. `resolvePrompt` — `aiResponseLanguage` для него игнорируется.
 */
export const DEFAULT_PROMPTS: Record<PromptId, string> = {
  commitMessage: [
    'You write git commit messages in the Conventional Commits format.',
    '',
    'Format:',
    '  <type>(<scope>): <subject>',
    '',
    '  [optional body]',
    '',
    '  [optional footer(s)]',
    '',
    'Rules:',
    '- type: exactly one of feat | fix | docs | style | refactor | perf | test | build | ci | chore | revert.',
    '  Pick from the diff: new user-facing capability -> feat; bugfix -> fix; only docs/comments -> docs;',
    '  refactor without behavior change -> refactor; perf-only change -> perf; tests-only -> test;',
    '  build/tooling/deps -> build or chore; CI config -> ci; pure formatting -> style.',
    '- scope: short name of the affected area (package, module, feature). Lowercase ASCII, optional.',
    '  Omit the parentheses entirely if the change spans many unrelated areas.',
    '- type and scope MUST be plain ASCII English keywords even when the rest of the message is in another language.',
    '  Conventional-Commits validators (commitlint, husky regex hooks) look for the literal latin tokens.',
    '- subject: imperative mood, lowercase start, no trailing period, <=72 chars, single line.',
    '- Optional body after a blank line: wrap at 72 chars, explain "why" not "what".',
    '  Skip the body entirely if the subject is self-explanatory.',
    '- Optional footer(s): "BREAKING CHANGE: <description>" for breaking changes; "Refs #123" for issues.',
    '- No backticks, no markdown, no surrounding quotes, no leading/trailing whitespace.',
    '- Respond with ONLY the commit message text. Do not add explanations, preambles or commentary.',
  ].join('\n'),
  // TODO(ai-tier2): real prompt body lands together with the Commit Explainer feature.
  explainCommit: 'TODO(ai-tier2): explainCommit prompt placeholder.',
  // TODO(ai-tier2): real prompt body lands together with the Smart Stash Naming feature.
  stashName: 'TODO(ai-tier2): stashName prompt placeholder.',
  // TODO(ai-tier2): real prompt body lands together with the Reflog Explainer feature.
  explainReflog: 'TODO(ai-tier2): explainReflog prompt placeholder.',
  // TODO(ai-tier2): real prompt body lands together with the Conflict Helper feature.
  analyzeConflict: 'TODO(ai-tier2): analyzeConflict prompt placeholder.',
};

const LANGUAGE_NAMES: Record<'en' | 'ru', string> = {
  en: 'English',
  ru: 'Russian',
};

/**
 * Собрать финальный текст промпта для фичи `id`.
 *
 * Источник базового текста: `cfg.prompts?.[id]` (пользовательский override)
 * или `DEFAULT_PROMPTS[id]` (английский по умолчанию).
 *
 * Язык вывода: `cfg.aiResponseLanguage`:
 *   - `en` или undefined по умолчанию -> ничего не добавляем (модель и так
 *     знает «отвечай так же, как просили»);
 *   - `ru` -> добавляем инструкцию `Respond strictly in Russian. Do not
 *     switch language mid-response.`;
 *   - `auto` -> рассматривается выше уровнем (renderer передаёт уже
 *     разрешённое 'en'/'ru' через `resolveResponseLanguage`).
 *
 * Исключение: `stashName` **всегда** возвращает английский — это git-имя,
 * не текст для пользователя, и оно идёт в command line / UI чекбоксы.
 * Поэтому для него инструкция про язык не добавляется никогда.
 */
export function resolvePrompt(id: PromptId, cfg: AiProviderConfig | null | undefined): string {
  const base = cfg?.prompts?.[id]?.trim() ? cfg.prompts[id]! : DEFAULT_PROMPTS[id];
  if (id === 'stashName') return base;
  const lang = resolveResponseLanguage(cfg, 'en');
  if (lang === 'en') return base;
  return `${base}\n\nIMPORTANT: Respond strictly in ${LANGUAGE_NAMES[lang]}. Do not switch language mid-response.`;
}

/**
 * Разрешить значение `cfg.aiResponseLanguage` в конкретный язык
 * `en`/`ru`. `auto` мапим в `fallback` (renderer обычно передаёт сюда
 * текущий язык UI).
 */
export function resolveResponseLanguage(
  cfg: AiProviderConfig | null | undefined,
  fallback: 'en' | 'ru' = 'en',
): 'en' | 'ru' {
  const setting = cfg?.aiResponseLanguage ?? 'auto';
  if (setting === 'en' || setting === 'ru') return setting;
  return fallback;
}

/**
 * Системный промпт с учётом выбранного языка commit message. `auto` — не
 * добавляем инструкцию про язык (пусть модель решает сама).
 *
 * Логика языковой инструкции отличается от `resolvePrompt`: тут язык
 * прописывается **внутри Rules:** (типа «- LANGUAGE: ...»). Это нужно
 * для маленьких моделей (Qwen 7B / Llama 8B), которые не всегда честно
 * выполняют hint в конце промпта. Заодно сохраняется обратная
 * совместимость с фолбэком `forceSystemInUser` в AiService.
 */
export function buildCommitSystemPrompt(language: CommitLanguage = 'auto'): string {
  const base = DEFAULT_PROMPTS.commitMessage;
  const langLine = commitLanguageInstruction(language);
  return langLine ? `${base}\n${langLine}` : base;
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
        '- ЯЗЫК: Пиши subject и body коммит-сообщения на русском языке.',
        '- LANGUAGE: Write the subject and body of the commit message in Russian. Do not mix languages in prose.',
        '- ИСКЛЮЧЕНИЕ: Conventional-Commits префикс остаётся английским ASCII —',
        '  type (feat/fix/docs/...) и scope не переводить, иначе валидаторы хуков отклонят коммит.',
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
