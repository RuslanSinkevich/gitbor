/** Идентификаторы моделей chat.qwen.ai (как в Skycode qwen-web). */
export const QWEN_WEB_MODEL_IDS = [
  'qwen3-max',
  'qwen3-coder-plus',
  'qwen3-vl-plus',
  'qwen3-235b-a22b',
  'qwen-max-latest',
  'qwq-32b',
] as const;

export type QwenWebModelId = (typeof QWEN_WEB_MODEL_IDS)[number];

export const QWEN_WEB_DEFAULT_MODEL_ID: QwenWebModelId = 'qwen3-max';

export function isQwenWebModelId(id: string): id is QwenWebModelId {
  return (QWEN_WEB_MODEL_IDS as readonly string[]).includes(id);
}
