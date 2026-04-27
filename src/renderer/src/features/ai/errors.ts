import { t, tpl } from '../../i18n';

/**
 * Известные `kind` ошибок, которые присылает main-процесс через `aiError`.
 * Любое значение вне списка считается «generic» и локализуется общим текстом.
 * Сырой `message` обычно приходит на английском (текст от провайдера или
 * internal-строка main'а). Он полезен для диагностики — добавляем отдельной
 * строкой «Details: …», если он не совпадает с локализованным сообщением.
 */
export type AiErrorKind =
  | 'config'
  | 'unavailable'
  | 'noRepo'
  | 'nothingStaged'
  | 'network'
  | 'http'
  | 'timeout'
  | 'aborted'
  | 'parse'
  | 'emptyResponse'
  | 'lengthTruncated'
  | 'error'
  | string;

/**
 * Превращает пару (kind, message) из main-процесса в локализованный текст.
 * Возвращает объект, чтобы UI мог отрисовать основной перевод + сырой
 * technical-detail раздельно при желании.
 */
export interface LocalizedAiError {
  /** Локализованное «почему». Всегда непустое. */
  title: string;
  /** Сырой англоязычный текст от провайдера / main — для диагностики. */
  details: string;
  /** Готовая строка «title (Details: …)» — для баннеров-одностроек. */
  full: string;
}

export function localizeAiError(kind: AiErrorKind, message: string): LocalizedAiError {
  const e = t().ai.errors;
  const raw = (message ?? '').trim();
  const lower = raw.toLowerCase();

  // Эвристика по тексту: main шлёт одинаковый kind для нескольких причин
  // (например kind='config' для `AI module unavailable`, `No repository open`,
  // `Nothing is staged`, `AI provider is not configured`).
  let title: string;
  if (lower.includes('ai module unavailable')) title = e.unavailable;
  else if (lower.includes('no repository open')) title = e.noRepo;
  else if (lower.includes('nothing is staged')) title = e.nothingStaged;
  else if (lower.includes('max_tokens') && lower.includes('before producing')) title = e.lengthTruncated;
  else if (lower.includes('empty response')) title = e.emptyResponse;
  else if (lower.includes('provider is not configured')) title = e.config;
  else title = titleByKind(kind, e);

  const showDetails = raw.length > 0 && raw.toLowerCase() !== title.toLowerCase();
  const full = showDetails ? `${title} ${tpl(e.details, { message: raw })}` : title;
  return { title, details: raw, full };
}

function titleByKind(kind: AiErrorKind, e: ReturnType<typeof t>['ai']['errors']): string {
  switch (kind) {
    case 'config':
      return e.config;
    case 'network':
      return e.network;
    case 'http':
      return e.http;
    case 'timeout':
      return e.timeout;
    case 'aborted':
      return e.aborted;
    case 'parse':
      return e.parse;
    default:
      return e.generic;
  }
}
