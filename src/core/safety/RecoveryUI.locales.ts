/**
 * Локали для диалога «Git не найден» из `RecoveryUI.showGitNotFoundMessage`.
 * Лежат рядом с потребителем по той же логике, что и `LongPathSuggester.locales.ts`:
 * main-side i18n инфраструктуры в проекте нет, а тащить renderer-side i18n
 * (`src/renderer/src/i18n/`) в main-процесс ради двух языков и трёх строк —
 * избыточно.
 *
 * Кнопок ровно две: [download, quit]. Прошлая «Указать путь к Git» убрана —
 * без обработчика она вводила пользователя в заблуждение, а реализация
 * file picker'а для git-binary — отдельный стрим.
 */

export interface GitNotFoundLocale {
  /** Заголовок message box. */
  title: string;
  /** Основной текст: «Git не найден…» + «после установки перезапустите». */
  message: string;
  /**
   * Пара кнопок: [downloadGit, quit]. Порядок коррелирует с response-кодами
   * 0/1 в `showGitNotFoundMessage`.
   */
  buttons: readonly [string, string];
  /** URL страницы загрузки Git (одинаковый для всех локалей). */
  downloadUrl: string;
}

const en: GitNotFoundLocale = {
  title: 'SkyFork',
  message:
    'Git not found. SkyFork requires Git to operate. After installing Git, restart the application.',
  buttons: ['Download Git', 'Quit'],
  downloadUrl: 'https://git-scm.com/downloads',
};

const ru: GitNotFoundLocale = {
  title: 'SkyFork',
  message:
    'Git не обнаружен. Для работы приложения необходим Git. После установки Git перезапустите приложение.',
  buttons: ['Скачать Git', 'Закрыть'],
  downloadUrl: 'https://git-scm.com/downloads',
};

/**
 * Выбор локали по тегу из `app.getLocale()` (BCP-47, напр. `ru-RU`, `en-US`).
 * Только две локали; всё неузнанное — `en` fallback.
 */
export function pickGitNotFoundLocale(localeTag: string | undefined): GitNotFoundLocale {
  if (!localeTag) return en;
  return localeTag.toLowerCase().startsWith('ru') ? ru : en;
}
