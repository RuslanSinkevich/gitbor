/**
 * AI-модуль: OpenAI-compatible `/v1/chat/completions` и режим Qwen Web
 * (токен сессии https://chat.qwen.ai).
 */

/**
 * Язык, на котором модель должна писать commit message. Не связан с языком
 * UI. `auto` — не навязывать, модель сама подстраивается под diff.
 *
 * @deprecated Внутренне всё ведётся через `aiResponseLanguage` (общий для
 * всех AI-фич). Тип оставлен для обратной совместимости подписи
 * `AiProviderConfig.commitLanguage` и старых тестов.
 */
export type CommitLanguage = 'auto' | 'en' | 'ru';

/** Язык ответа AI (одно поле для всех фич, заменяет старый `commitLanguage`). */
export type AiResponseLanguage = 'auto' | 'en' | 'ru';

/** Режим подключения: OpenAI-compatible endpoint или сессия chat.qwen.ai. */
export type AiConnectionMode = 'openai-compatible' | 'qwen-web';

/**
 * Идентификаторы доступных промптов. На этапе AI Settings Redesign в
 * `DEFAULT_PROMPTS` реально заполнен только `commitMessage` —
 * остальные ID добавлены наперёд под фичи Tier-2 (Commit Explainer,
 * Stash Naming, Reflog Explainer, Conflict Helper). Текст-заглушка
 * с TODO остаётся в DEFAULT_PROMPTS до соответствующего этапа.
 */
export type PromptId =
  | 'commitMessage'
  | 'explainCommit'
  | 'stashName'
  | 'explainReflog'
  | 'analyzeConflict';

/**
 * Идентификаторы фич, которые юзер может выключить в Settings. Совпадают
 * с PromptId плюс отдельный `semanticSearch` (он не использует один
 * текстовый промпт). Дёргается в renderer перед каждым AI-вызовом и
 * в AiService при первой попытке.
 */
export type AiFeatureId = PromptId | 'semanticSearch';

/** Конфигурация подключения к AI-провайдеру. */
export interface AiProviderConfig {
  /**
   * `openai-compatible` — поле baseUrl + apiKey.
   * `qwen-web` — токен из localStorage chat.qwen.ai, см. qwenWebToken.
   */
  mode?: AiConnectionMode;
  /** Базовый URL до `/chat/completions` (обычно заканчивается на `/v1`). */
  baseUrl: string;
  /** API-ключ. Пустая строка — без авторизации (локальные серверы). */
  apiKey: string;
  /** Токен сессии https://chat.qwen.ai (только при mode=qwen-web). */
  qwenWebToken?: string;
  /** Идентификатор модели (например `gpt-4o-mini`, `llama3.1:8b`). */
  model: string;
  /**
   * Язык генерируемого commit message. По умолчанию `auto`. Хранится в
   * конфиге провайдера, а не отдельно, чтобы разные провайдеры/рабочие места
   * могли иметь разные настройки без расщепления store.
   *
   * @deprecated с конфига v3 заменено на `aiResponseLanguage` (общий язык
   * ответа для всех AI-фич). Поле оставлено в типе, чтобы старый код
   * (тесты, миграции) продолжал собираться; новые места читают только
   * `aiResponseLanguage`.
   */
  commitLanguage?: CommitLanguage;
  /**
   * Язык ответа AI — общий для всех фич (commit message, explainCommit,
   * explainReflog, analyzeConflict). `auto` = язык UI (`getLang()` в
   * renderer); промпт идёт на английском (см. DEFAULT_PROMPTS), язык
   * вывода добавляется в конец промпта через `resolvePrompt(id, cfg)`.
   *
   * stashName всегда возвращает английский, независимо от значения
   * (это git-имя, а не текст для человека).
   */
  aiResponseLanguage?: AiResponseLanguage;
  /** Кастомные промпты, перекрывающие defaults из `DEFAULT_PROMPTS`. */
  prompts?: Partial<Record<PromptId, string>>;
  /**
   * Per-feature toggle. Если `false` — фича выключена; renderer прячет/
   * disable'ит UI, AiService при попытке вызова кидает AiError(`config`).
   * undefined = унаследовать default по фиче (см. `isFeatureEnabled`).
   */
  features?: Partial<Record<AiFeatureId, boolean>>;
  /**
   * Per-feature override модели. Если для конкретной фичи задан id —
   * провайдер вызывается с ним вместо основного `config.model`.
   * Полезно: дешёвая модель для stash naming, дорогая для conflict.
   */
  modelOverrides?: Partial<Record<AiFeatureId, string>>;
  /**
   * Глобальный AI kill-switch. `false` — все AI-кнопки disabled, IPC
   * методы возвращают AiError. Default = true.
   */
  aiEnabled?: boolean;
  /**
   * Разрешить отправлять diff/code в **зарубежные** провайдеры (OpenAI,
   * Anthropic, Groq). Default для свежих установок = `false` (импорто-
   * замещение: юзер должен явно понимать, что код покидает РФ).
   * Локальные, корпоративные, без-VPN и российские провайдеры под
   * это ограничение **не подпадают**.
   */
  allowCloudCodeShare?: boolean;
  /** Дополнительные HTTP-заголовки (например для корп.прокси). */
  headers?: Record<string, string>;
  /** Таймаут запроса в миллисекундах. По умолчанию 60000. */
  timeoutMs?: number;

  // ─── Обходы типовых проблем корпоративных gateway'ев ───

  /**
   * Слить system + user в одно user-сообщение. Для gateway'ев (FastGPT/OneAPI/Dify),
   * которые роняют или перезаписывают role:system.
   */
  systemInUser?: boolean;
  /**
   * Отключить thinking-режим Qwen3 через `extra_body.enable_thinking: false`
   * (vLLM-параметр). Незнакомые gateway'и просто проигнорируют поле.
   */
  qwenDisableThinking?: boolean;
  /** Принудительно вырезать `<think>...</think>` из ответа. */
  stripThinkTags?: boolean;
  /** Произвольные поля для merge в request body (для Alibaba `parameters.*` и пр.). */
  extraBody?: Record<string, unknown>;
  /** Логировать последний request/response в `userData/ai-debug.log` и держать в памяти. */
  debugLogging?: boolean;
}

/** Снимок последнего AI-запроса (для диагностической панели). */
export interface AiDebugSnapshot {
  startedAt: number;
  url: string;
  request: Record<string, unknown>;
  responseText?: string;
  responseJson?: unknown;
  rawSseHead?: string;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  ttfbMs?: number;
  totalMs?: number;
  httpStatus?: number;
  error?: string;
  /** Если выставлено: повторили запрос с systemInUser=true автоматически. */
  fallbackRetry?: 'systemInUser';
}

/** Опции одного вызова AI. */
export interface AiCompletionOptions {
  /** Системный промпт (роль `system`). */
  systemPrompt?: string;
  /** Пользовательский промпт (роль `user`). */
  userPrompt: string;
  /** Максимум токенов в ответе. */
  maxTokens?: number;
  /** Температура, 0..2. */
  temperature?: number;
  /** Сигнал для отмены запроса. */
  signal?: AbortSignal;
  /** Колбек на каждый чанк при streaming. Если не задан — не стримим. */
  onChunk?: (delta: string) => void;
  /** Если задан — провайдер заполнит снимок (request/response/тайминги). */
  debugSink?: (snapshot: AiDebugSnapshot) => void;
  /** Принудительно объединить system+user (overrides config.systemInUser). */
  forceSystemInUser?: boolean;
}

/** Результат AI-запроса. */
export interface AiCompletionResult {
  /** Сгенерированный текст целиком. */
  text: string;
  /** Причина остановки: 'stop' | 'length' | 'aborted' | 'error'. */
  finishReason: 'stop' | 'length' | 'aborted' | 'error';
  /** Использованные токены (если провайдер сообщает). */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/** Ошибка AI-запроса со структурированной информацией. */
export class AiError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'http' | 'timeout' | 'aborted' | 'parse' | 'config',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
