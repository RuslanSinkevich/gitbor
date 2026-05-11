import type { AiProviderConfig, AiConnectionMode } from '../core/ai/types';
import { mainLogger } from '../core/utils/Logger';

/**
 * Возвращает список origin'ов, которые нужно добавить в `connect-src` CSP
 * для текущей AI-конфигурации. Чистая функция без side-effects (кроме
 * `mainLogger.warn` на невалидный baseUrl).
 *
 * Используется в main.ts из webRequest.onHeadersReceived для построения
 * HTTP-header CSP, который накладывается ПОВЕРХ HTML-meta CSP в renderer'е
 * (последний остаётся жёстким `connect-src 'self' https:` как defense-in-depth;
 * HTTP-header перекрывает его, ограничивая до конкретного провайдера).
 *
 * Контракт по режимам:
 * - `null` / unconfigured → `[]` (никаких внешних HTTP не разрешено).
 * - `openai-compatible` + валидный baseUrl → `[origin]`. Поддерживает и
 *   https (cloud), и http (Ollama на localhost).
 * - `qwen-web` → всегда `['https://chat.qwen.ai']` (baseUrl игнорируется,
 *   потому что AiConfigStore затирает его пустой строкой при сохранении).
 * - Невалидный URL (например пользователь вбил мусор) → `[]` + warn в лог.
 *   Не throw'аем, чтобы не уронить webRequest hook на каждом запросе.
 */
export function computeAiOrigins(config: AiProviderConfig | null): string[] {
  if (!config) return [];

  const mode: AiConnectionMode = config.mode ?? 'openai-compatible';

  if (mode === 'qwen-web') {
    return ['https://chat.qwen.ai'];
  }

  const baseUrl = config.baseUrl?.trim();
  if (!baseUrl) return [];

  try {
    const origin = new URL(baseUrl).origin;
    if (!origin || origin === 'null') {
      mainLogger.warn(`computeAiOrigins: baseUrl='${baseUrl}' has no usable origin`);
      return [];
    }
    return [origin];
  } catch {
    mainLogger.warn(`computeAiOrigins: invalid baseUrl='${baseUrl}', skipping`);
    return [];
  }
}
