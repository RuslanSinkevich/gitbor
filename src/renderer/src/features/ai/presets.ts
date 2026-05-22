import type { AiConnectionMode } from '../../types';

type AiPresetLabelKey =
  | 'presetOpenai'
  | 'presetOllama'
  | 'presetLmStudio'
  | 'presetDeepseek'
  | 'presetGroq'
  | 'presetQwenWeb'
  | 'presetQwenCorporate'
  | 'presetCustom';

export interface AiPreset {
  id: string;
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
 */
export const AI_PRESETS: AiPreset[] = [
  { id: 'openai',   labelKey: 'presetOpenai',   mode: 'openai-compatible', baseUrl: 'https://api.openai.com/v1',     model: 'gpt-4o-mini',      needsKey: true  },
  { id: 'ollama',   labelKey: 'presetOllama',   mode: 'openai-compatible', baseUrl: 'http://localhost:11434/v1',     model: 'llama3.1:8b',      needsKey: false },
  { id: 'lmstudio', labelKey: 'presetLmStudio', mode: 'openai-compatible', baseUrl: 'http://localhost:1234/v1',      model: 'local-model',      needsKey: false },
  { id: 'deepseek', labelKey: 'presetDeepseek', mode: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1',   model: 'deepseek-chat',    needsKey: true  },
  { id: 'groq',     labelKey: 'presetGroq',     mode: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', needsKey: true },
  /** Токен из localStorage https://chat.qwen.ai (неофициальный Qwen Web API). */
  { id: 'qwen-web', labelKey: 'presetQwenWeb',  mode: 'qwen-web',            baseUrl: '',                              model: 'qwen3-max',        needsKey: true },
  /** Корпоративный gateway Qwen (vLLM/DashScope). Включает обходы для system-prompt и thinking. */
  { id: 'qwen-corporate', labelKey: 'presetQwenCorporate', mode: 'openai-compatible', baseUrl: '', model: '', needsKey: true,
    defaults: { systemInUser: true, stripThinkTags: true } },
];

/** Угадать пресет (подсветка кнопки). */
export function detectPreset(
  mode: AiConnectionMode,
  baseUrl: string,
  model: string,
  flags?: { systemInUser?: boolean; stripThinkTags?: boolean },
): string {
  if (mode === 'qwen-web') {
    const p = AI_PRESETS.find((x) => x.mode === 'qwen-web');
    if (p && model.trim() === p.model) return p.id;
    return 'custom';
  }
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  for (const p of AI_PRESETS) {
    if (p.mode !== 'openai-compatible') continue;
    if (p.id === 'qwen-corporate') continue;
    if (p.baseUrl.replace(/\/+$/, '') === normalized) return p.id;
  }
  if (flags?.systemInUser && flags?.stripThinkTags) return 'qwen-corporate';
  return 'custom';
}
