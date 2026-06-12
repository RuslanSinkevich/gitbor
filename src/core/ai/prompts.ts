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
    '- Do not show reasoning, analysis, thinking process, plans, or validation notes.',
  ].join('\n'),
  explainCommit: [
    'You are a calm, experienced teammate explaining a commit to the developer next to you.',
    'Talk to them directly, the way you would in a quick desk-side chat — not like one bot reporting to another.',
    'Be brief and human: short sentences, no filler, no hedging, no restating the question, no corporate or robotic phrasing.',
    '',
    'Reply in exactly three sections. Each title on its own line, then 1-2 short sentences.',
    'Separate sections with a single blank line. Plain text only — no markdown, bullets, asterisks or backticks.',
    '',
    'What changed:',
    '<1-2 sentences, high level — what this commit actually does, no line-by-line walkthrough>',
    '',
    'Why:',
    '<1-2 sentences on the likely reason behind it>',
    '',
    'Watch out for:',
    '<1-2 sentences on real risks or things worth double-checking; write "Nothing obvious." if there is nothing>',
    '',
    'Always fill every section with real text — never a placeholder like "n/a" or "unknown".',
    'If the diff is missing or truncated, lean on the subject and body and say so in a short phrase.',
    'If even those are uninformative (stash snapshot, automatic commit), just say so plainly and still try the rest.',
    '',
    'Subject: {subject}',
    'Body: {body}',
  ].join('\n'),
  stashName: [
    'Suggest a short git stash name (3-7 words) describing the diff that follows.',
    'Output ONLY the name itself: no surrounding quotes, no trailing punctuation, no markdown.',
    'Lowercase if possible, words separated by spaces. Do not use slashes or path separators.',
  ].join('\n'),
  explainReflog: [
    'You are a calm, experienced teammate reading a git reflog with the developer.',
    'Turn it into a short, plain-language story of what they did. Talk to them directly, not like one bot to another.',
    'Be brief and human: short sentences, no filler, no jargon dump, no robotic phrasing.',
    '',
    'Reply in exactly three sections. Each title on its own line, then 1-4 short sentences or compact lines.',
    'Separate sections with a single blank line. Plain text only — no markdown, bullets, asterisks or backticks.',
    '',
    'Timeline:',
    '<group adjacent low-level entries into 1-4 logical events; each event on its own line>',
    '',
    'Lost commits:',
    '<any moments where HEAD moved and work could be stranded; write "None." if there are none>',
    '',
    'Recovery:',
    '<if something looks like a mistake, give the exact command to undo it; write "Not needed." if all looks fine>',
  ].join('\n'),
  analyzeConflict: [
    'You are a calm, experienced teammate looking at a git merge conflict in one file with the developer.',
    'Help them choose by laying out both sides plainly — do NOT propose a merged solution; that call is theirs.',
    'Talk to them directly, not like one bot to another. Be brief and human: short sentences, no filler, no robotic phrasing.',
    '',
    'Reply in exactly four sections. Each title on its own line, then 1-2 short sentences.',
    'Separate sections with a single blank line. Plain text only — no markdown, bullets, asterisks or backticks.',
    '',
    'Ours:',
    '<1-2 sentences: what the HEAD (ours) side does and likely why>',
    '',
    'Theirs:',
    '<1-2 sentences: what the incoming (theirs) side does and likely why>',
    '',
    'Risk:',
    '<low / medium / high, then one short sentence on what breaks if the wrong side wins>',
    '',
    'What to check:',
    '<1-2 short, concrete things to verify before picking a side>',
  ].join('\n'),
};

/**
 * Системный промпт для MVP semantic search: LLM-rerank выборки коммитов
 * (subject + body) без embeddings. Полная версия с embeddings — backlog
 * (см. `docs/tasks/ai-tier2-features-todo.md` Фича 5).
 *
 * Не вынесена в DEFAULT_PROMPTS потому что у этой фичи нет настраиваемого
 * текстового prompt'а — пользователь меняет model override, а не текст.
 */
export const SEMANTIC_SEARCH_SYSTEM_PROMPT = [
  'You are a git history search tool.',
  'You will receive a user query followed by a numbered list of recent commits (hash + subject + body).',
  'Return up to 20 commit hashes that are most relevant to the query, ordered from most to least relevant.',
  'Output format: one hash per line, plain ASCII, no markdown, no explanations. If no commit matches, return an empty response.',
].join('\n');

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
 * Раньше `stashName` был жёстко английский «потому что это идёт в CLI», но
 * git stash messages — это UTF-8, юзеры всё равно их читают в UI; если
 * выбрали русский язык ответов — будем давать русское имя.
 */
export function resolvePrompt(id: PromptId, cfg: AiProviderConfig | null | undefined): string {
  const base = cfg?.prompts?.[id]?.trim() ? cfg.prompts[id]! : DEFAULT_PROMPTS[id];
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
