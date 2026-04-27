export type AiPresetLabelKey =
  | 'presetOpenai'
  | 'presetOllama'
  | 'presetLmStudio'
  | 'presetDeepseek'
  | 'presetGroq'
  | 'presetCustom';

export interface AiPreset {
  id: string;
  labelKey: AiPresetLabelKey;
  baseUrl: string;
  model: string;
  needsKey: boolean;
}

/**
 * Готовые комбинации base URL + стандартной модели для популярных
 * OpenAI-compatible сервисов. «Custom» — ручной ввод.
 */
export const AI_PRESETS: AiPreset[] = [
  { id: 'openai',   labelKey: 'presetOpenai',   baseUrl: 'https://api.openai.com/v1',     model: 'gpt-4o-mini',      needsKey: true  },
  { id: 'ollama',   labelKey: 'presetOllama',   baseUrl: 'http://localhost:11434/v1',     model: 'llama3.1:8b',      needsKey: false },
  { id: 'lmstudio', labelKey: 'presetLmStudio', baseUrl: 'http://localhost:1234/v1',      model: 'local-model',      needsKey: false },
  { id: 'deepseek', labelKey: 'presetDeepseek', baseUrl: 'https://api.deepseek.com/v1',   model: 'deepseek-chat',    needsKey: true  },
  { id: 'groq',     labelKey: 'presetGroq',     baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', needsKey: true },
];

/** Угадать пресет по текущему baseUrl (для подсветки активного). */
export function detectPreset(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  for (const p of AI_PRESETS) {
    if (p.baseUrl.replace(/\/+$/, '') === normalized) return p.id;
  }
  return 'custom';
}
