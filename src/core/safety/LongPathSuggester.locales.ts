/**
 * Локали для `LongPathSuggester`. Лежат рядом с потребителем намеренно:
 * main-side i18n инфраструктуры в проекте нет, renderer-side i18n
 * (`src/renderer/src/i18n/`) недоступна из main-процесса. Чтобы не плодить
 * новый shared-модуль ради двух языков и пяти строк — фиксируем строки
 * прямо здесь.
 *
 * Если в будущем появятся ещё несколько main-side диалогов, требующих
 * локализации, имеет смысл вынести общий `pickLocaleByTag` в
 * `src/core/utils/`. Сейчас — overengineering.
 */

export interface LongPathLocale {
  /** Заголовок suggest-диалога. */
  title: string;
  /** Однострочное message в suggest-диалоге. */
  message: string;
  /** Подробное описание в suggest-диалоге. */
  detail: string;
  /**
   * Тройка кнопок: [enable, notNow, learnMore].
   * Порядок коррелирует с response-кодами 0/1/2 в `inspectStderr`.
   */
  buttons: readonly [string, string, string];
  /** Сообщение успеха после `git config core.longpaths=true`. */
  successMessage: string;
  /** Шаблон сообщения ошибки (получает stderr/exit-code как строку). */
  errorMessage: (reason: string) => string;
  /** URL «Подробнее» — у MS есть локализованные зеркала. */
  learnMoreUrl: string;
}

const en: LongPathLocale = {
  title: 'SkyFork — long paths',
  message: 'Git cannot handle long paths',
  detail:
    'On Windows the default maximum path length is ~260 characters. ' +
    'Enable globally `git config --global core.longpaths true`? ' +
    'This is the recommended setting for development on Windows.',
  buttons: ['Enable', 'Not now', 'Learn more'],
  successMessage: 'core.longpaths=true enabled globally. Retry the operation.',
  errorMessage: (reason) => `Failed to set core.longpaths: ${reason}`,
  learnMoreUrl:
    'https://learn.microsoft.com/windows/win32/fileio/maximum-file-path-limitation',
};

const ru: LongPathLocale = {
  title: 'SkyFork — длинные пути',
  message: 'Git не справляется с длинными путями',
  detail:
    'На Windows по умолчанию максимальная длина пути ~260 символов. ' +
    'Включить глобально `git config --global core.longpaths true`? ' +
    'Это рекомендованная настройка для разработки на Windows.',
  buttons: ['Включить', 'Не сейчас', 'Подробнее'],
  successMessage: 'core.longpaths=true включено глобально. Повторите операцию.',
  errorMessage: (reason) => `Не удалось установить core.longpaths: ${reason}`,
  learnMoreUrl:
    'https://learn.microsoft.com/ru-ru/windows/win32/fileio/maximum-file-path-limitation',
};

export const longPathLocales = { en, ru } as const;

/**
 * Выбор локали по тегу из `app.getLocale()` (BCP-47, напр. `ru-RU`, `en-US`).
 * Только две локали; всё неузнанное — `en` fallback.
 */
export function pickLongPathLocale(localeTag: string | undefined): LongPathLocale {
  if (!localeTag) return en;
  return localeTag.toLowerCase().startsWith('ru') ? ru : en;
}
