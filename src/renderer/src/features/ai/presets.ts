import type { AiConnectionMode } from '../../types';

/**
 * Логические группы провайдеров в Connection-табе. Порядок зафиксирован
 * как «приоритет для импортозамещающего продукта»:
 *
 *   1. local       — данные не покидают компьютер (Ollama / LM Studio /
 *                    llama.cpp). Default-выбор для свежей установки.
 *   2. corporate   — self-hosted / внутренний gateway (Qwen Corporate,
 *                    custom OpenAI-compatible). В крупных компаниях
 *                    разработчик часто вообще не имеет выбора кроме
 *                    внутреннего LLM-gateway.
 *   3. no-vpn      — доступно из РФ без VPN (Qwen API, DeepSeek).
 *   4. russian     — российские провайдеры (YandexGPT). GigaChat —
 *                    backlog: требует отдельного OAuth-flow, не
 *                    укладывается в OpenAI-compatible.
 *   5. foreign     — зарубежные провайдеры (OpenAI, Anthropic, Groq).
 *                    Подпадают под `allowCloudCodeShare`-gate.
 */
export type AiPresetGroup = 'local' | 'corporate' | 'no-vpn' | 'russian' | 'foreign';

type AiPresetLabelKey =
  | 'presetOpenai'
  | 'presetAnthropic'
  | 'presetOllama'
  | 'presetLmStudio'
  | 'presetLlamaCpp'
  | 'presetDeepseek'
  | 'presetGroq'
  | 'presetQwenApi'
  | 'presetQwenCorporate'
  | 'presetYandexGpt'
  | 'presetCustomCorporate'
  | 'presetCustom';

export interface AiPreset {
  id: string;
  group: AiPresetGroup;
  labelKey: AiPresetLabelKey;
  mode: AiConnectionMode;
  baseUrl: string;
  model: string;
  needsKey: boolean;
  /** Опциональные дефолты для обхода типовых проблем gateway'ев. */
  defaults?: {
    systemInUser?: boolean;
    qwenDisableThinking?: boolean;
    stripThinkTags?: boolean;
  };
}

/**
 * Готовые комбинации base URL + стандартной модели для популярных
 * OpenAI-compatible сервисов. «Custom» — ручной ввод.
 *
 * **Default preset** для пустого конфига — Ollama (см. порядок в массиве:
 * первый local-пресет идёт первым). См. также `DEFAULT_PRESET_ID`.
 */
export const AI_PRESETS: AiPreset[] = [
  // ── 1. local ──
  { id: 'ollama',     group: 'local', labelKey: 'presetOllama',   mode: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1:8b',  needsKey: false },
  { id: 'lmstudio',   group: 'local', labelKey: 'presetLmStudio', mode: 'openai-compatible', baseUrl: 'http://localhost:1234/v1',  model: 'local-model',  needsKey: false },
  { id: 'llama-cpp',  group: 'local', labelKey: 'presetLlamaCpp', mode: 'openai-compatible', baseUrl: 'http://localhost:8080/v1',  model: 'local-model',  needsKey: false },

  // ── 2. corporate ──
  { id: 'qwen-corporate',    group: 'corporate', labelKey: 'presetQwenCorporate',    mode: 'openai-compatible', baseUrl: '', model: '', needsKey: true, defaults: { systemInUser: true, stripThinkTags: true } },
  { id: 'custom-corporate',  group: 'corporate', labelKey: 'presetCustomCorporate',  mode: 'openai-compatible', baseUrl: '', model: '', needsKey: true },

  // ── 3. no-vpn ──
  { id: 'qwen-api',   group: 'no-vpn', labelKey: 'presetQwenApi',  mode: 'openai-compatible',   baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', needsKey: true },
  { id: 'deepseek',   group: 'no-vpn', labelKey: 'presetDeepseek', mode: 'openai-compatible',   baseUrl: 'https://api.deepseek.com/v1',     model: 'deepseek-chat',       needsKey: true },

  // ── 4. russian ──
  // YandexGPT via Yandex Cloud OpenAI-compatible endpoint. API key from Yandex Cloud.
  { id: 'yandexgpt',  group: 'russian', labelKey: 'presetYandexGpt', mode: 'openai-compatible', baseUrl: 'https://llm.api.cloud.yandex.net/v1', model: 'yandexgpt-lite', needsKey: true },
  // TODO(ai-settings-redesign): GigaChat (Сбер) — отдельный provider с OAuth.
  //   В MVP не вписывается: нужен GigaChatProvider с обменом токена,
  //   а не OpenAI-compatible /chat/completions. Оставлен в backlog,
  //   будет добавлен отдельным пресетом + новым provider'ом.

  // ── 5. foreign ──
  { id: 'openai',     group: 'foreign', labelKey: 'presetOpenai',    mode: 'openai-compatible', baseUrl: 'https://api.openai.com/v1',     model: 'gpt-4o-mini',          needsKey: true },
  { id: 'anthropic',  group: 'foreign', labelKey: 'presetAnthropic', mode: 'openai-compatible', baseUrl: 'https://api.anthropic.com/v1',  model: 'claude-3-5-sonnet-20241022', needsKey: true },
  { id: 'groq',       group: 'foreign', labelKey: 'presetGroq',      mode: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant',  needsKey: true },
];

/** Default preset для пустой установки. См. описание группировки выше. */
export const DEFAULT_PRESET_ID = 'ollama';

/**
 * Список пресетов в порядке отображения, сгруппированный по `group`.
 * Используется в `ConnectionSection` для рендера optgroup'ов.
 */
export function getPresetsByGroup(): Record<AiPresetGroup, AiPreset[]> {
  const acc: Record<AiPresetGroup, AiPreset[]> = {
    local: [], corporate: [], 'no-vpn': [], russian: [], foreign: [],
  };
  for (const p of AI_PRESETS) acc[p.group].push(p);
  return acc;
}

/**
 * Является ли пресет «зарубежным» провайдером, на который распространяется
 * `allowCloudCodeShare`-gate. Локальные/корпоративные/без-VPN/российские —
 * ВСЕГДА разрешены (даже если данные физически идут через интернет, как
 * у DeepSeek или Qwen API: они не подпадают под политику «нельзя слать
 * код за пределы РФ без явного согласия юзера»).
 */
export function isForeignPreset(presetId: string): boolean {
  const p = AI_PRESETS.find((x) => x.id === presetId);
  return p?.group === 'foreign';
}

/**
 * Эвристика foreign-провайдера по baseUrl/mode для случая, когда юзер
 * выбрал `custom` или править baseUrl вручную. Возвращает true только
 * для известных foreign-хостов; неизвестное считаем «не foreign»,
 * чтобы не блокировать корпоративный gateway по ошибке.
 */
export function isForeignByConnection(mode: AiConnectionMode, baseUrl: string): boolean {
  if (mode !== 'openai-compatible') return false;
  const host = extractHost(baseUrl);
  if (!host) return false;
  const foreignHosts = AI_PRESETS
    .filter((p) => p.group === 'foreign' && p.mode === 'openai-compatible')
    .map((p) => extractHost(p.baseUrl))
    .filter((h): h is string => !!h);
  return foreignHosts.includes(host);
}

function extractHost(url: string): string | null {
  try {
    return new URL(url.trim()).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Угадать пресет (подсветка кнопки). */
export function detectPreset(
  mode: AiConnectionMode,
  baseUrl: string,
  flags?: { systemInUser?: boolean; stripThinkTags?: boolean },
): string {
  if (mode === 'qwen-web') {
    return 'custom';
  }
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  for (const p of AI_PRESETS) {
    if (p.mode !== 'openai-compatible') continue;
    if (p.id === 'qwen-corporate' || p.id === 'custom-corporate') continue;
    if (p.baseUrl.replace(/\/+$/, '') === normalized) return p.id;
  }
  if (flags?.systemInUser && flags?.stripThinkTags) return 'qwen-corporate';
  return 'custom';
}
