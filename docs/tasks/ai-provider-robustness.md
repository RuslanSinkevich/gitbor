# Задача: устойчивость переключения AI-провайдеров и диагностика «не видит промт»

> Стартовый промпт для нового агентского таба. Скопируй в новый чат.

---

## Проблема

При переключении AI-провайдера в настройках поведение разное:

- **qwen-web** (через токен chat.qwen.ai) — работает корректно, видит system-prompt, соблюдает язык;
- **openai-compatible** на корпоративную Qwen (внутренний gateway) — игнорирует system-prompt, делает на английском вместо выбранного русского, формат ответа не Conventional Commits.

Юзер видит «как будто другая модель и другие инструкции». Это не разовый случай, паттерн.

## Корень (гипотезы)

Код `OpenAiCompatibleProvider.buildRequestBody` правильный — формирует стандартный OpenAI chat-payload с `system` + `user`. Проблема **на стороне корпоративных gateway'ев** Qwen, и у нас нет инструментов это:
1) **продиагностировать** (юзер не видит, что именно отправляется и что приходит — кроме сухого «не работает»);
2) **обойти** для типовых случаев.

Типичные источники проблем у корпоративных Qwen-gateway'ев:

1. **Gateway переписывает system-prompt.** FastGPT / OneAPI / Dify в режиме proxy ставят свой default system поверх или вместо юзерского.
2. **DashScope OpenAI-compatible режим** для некоторых моделей требует `parameters.system` отдельно от `messages`, либо игнорирует `role: 'system'`.
3. **Qwen3 thinking mode.** По умолчанию модель оборачивает рассуждения в `<think>...</think>`, и в этом блоке может «забывать» инструкции. SSE-парсер у нас уже читает `reasoning_content`, но если gateway шлёт thinking как обычный `content` — он попадает в текст коммита.
4. **Длинный system-prompt** (~37 строк) обрезается gateway'ем по token-лимиту до нашего user-сообщения.
5. **Chat template несовместим.** Корпоративный vLLM может быть запущен с template, который ожидает другой порядок ролей или специальные токены.

## Цель

Дать юзеру:
- **видимость** что реально уходит на сервер и что приходит;
- **переключатели** под типовые проблемы корпоративных Qwen;
- **fallback-стратегии**, когда первый запрос дал пустой/левый ответ.

## Что сделать

### 1. AI Debug-панель

Новая опциональная панель в `AiSettingsDialog`: чекбокс «Enable debug logging». Когда включён:

- кнопка «Test prompt» рядом с «Test connection» — отправляет короткий dummy-diff и показывает:
  - **что отправили** (полный request body, аккуратно отформатированный JSON);
  - **что получили** (полный response: текст, raw SSE head если стрим, finish_reason, usage);
  - **тайминги** (TTFB, total).
- логи писать в `userData/ai-debug.log` (rotating, последние 1MB).
- в debug-режиме при реальной генерации сохранять последний request/response для просмотра через «Show last request».

Это не «фича» — это диагностический инструмент. Юзер должен иметь возможность увидеть, что system-prompt уходит правильно, и сравнить с тем что вернула модель.

### 2. Переключатели для типовых проблем Qwen

В `AiProviderConfig` добавить опциональные флаги (пресет «Qwen Corporate» их выставляет по умолчанию):

```ts
interface AiProviderConfig {
  ...
  /** Объединять system + user в один user-message. Для gateway'ев которые роняют system. */
  systemInUser?: boolean;
  /** Отключать thinking-режим через extra-параметр (Qwen3-specific). */
  qwenDisableThinking?: boolean;
  /** Принудительно вырезать <think>...</think> блоки из ответа. */
  stripThinkTags?: boolean;
  /** Кастомные параметры в body (для Alibaba `parameters.*`, vLLM `extra_body` и т.п.). */
  extraBody?: Record<string, unknown>;
}
```

Логика:

- `systemInUser: true` → `buildRequestBody` шлёт `messages: [{ role: 'user', content: <systemPrompt>\n\n<userPrompt> }]` без role:system. Многие проблемные gateway'и это съедают корректно.
- `qwenDisableThinking: true` → в body добавляется `extra_body: { enable_thinking: false }` (vLLM-параметр для Qwen3). Если gateway не поддерживает — игнорирует, не падает.
- `stripThinkTags: true` → в `postProcessCommit` или в `AiService.generateCommitMessage` после получения текста: `text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()`.
- `extraBody` мерджится в body последним, чтобы юзер мог добавить любое поле.

### 3. Новый preset «Qwen Corporate»

В `src/renderer/src/features/ai/presets.ts`:

```ts
{
  id: 'qwen-corporate',
  labelKey: 'presetQwenCorporate',
  mode: 'openai-compatible',
  baseUrl: '',  // юзер заполняет сам
  model: '',    // юзер заполняет сам
  needsKey: true,
  // defaults для типовой корпоративной Qwen:
  systemInUser: true,
  stripThinkTags: true,
}
```

Когда юзер выбирает этот пресет — флаги взводятся автоматически.

### 4. Fallback при пустом/слишком коротком ответе

В `AiService.generateCommitMessage` после получения результата:

- если `result.text.trim().length < 5` → **автоматический ретрай** с `systemInUser: true` (если изначально не было) и тегом «retry: system-merged» в логах;
- если после ретрая всё ещё пусто — бросить `AiError` с подсказкой «возможно gateway игнорирует system; попробуйте включить «System in user» в настройках».

### 5. Сохранение `commitLanguage` между провайдерами

Проверить и зафиксировать тестом: при `handlePreset` (`AiSettingsDialog.tsx:83-108`) `commitLanguage` НЕ сбрасывается. Юзер выставил `ru` для openai-провайдера → переключился на qwen-web → должен остаться `ru`. Сейчас вроде так и есть, но регрессионный тест не помешает.

### 6. Детектор thinking-utterances

В стрим-парсере (`OpenAiCompatibleProvider.readStream`): если первые ≥3 события содержат `<think>` или `reasoning_content` — пометить в debug-логе. После закрытия стрима — если в `text` остались `<think>...</think>` блоки и `stripThinkTags: false` — добавить warning в `mainLogger`:

```
AI: response contains <think> tags but stripThinkTags is disabled. Enable it in settings if commit messages contain reasoning.
```

### 7. i18n

Новые ключи:

```
ai.presetQwenCorporate: 'Qwen Corporate (vLLM/DashScope)'
ai.systemInUser: 'Send system prompt as user message'
ai.systemInUserHint: 'Some gateways drop the system role. Enable if commit messages ignore your settings.'
ai.qwenDisableThinking: 'Disable Qwen thinking mode'
ai.stripThinkTags: 'Strip <think>...</think> from responses'
ai.debugMode: 'Enable debug logging'
ai.showLastRequest: 'Show last request/response'
ai.testPrompt: 'Test prompt with sample diff'
ai.retryWithSystemInUser: 'Empty response; retried with system merged into user'
```

Зеркало на русский.

## Файлы

- `src/core/ai/types.ts` — расширить `AiProviderConfig`;
- `src/core/ai/providers/OpenAiCompatibleProvider.ts` — `systemInUser` в buildRequestBody, `extraBody`, детектор think;
- `src/core/ai/AiService.ts` — `stripThinkTags`, fallback-ретрай;
- `src/core/ai/AiConfigStore.ts` — сериализация новых полей;
- `src/core/ai/AiHandlers.ts` — новый IPC `aiTestPrompt` и `aiGetLastRequest`;
- `src/core/bridge/messages.ts` — типы;
- `src/renderer/src/features/ai/AiSettingsDialog.tsx` — debug-секция, новые чекбоксы (только в режиме `openai-compatible`);
- `src/renderer/src/features/ai/presets.ts` — пресет `qwen-corporate`;
- тесты на каждое новое поведение.

## Не делать

- Не вводить SDK (alibaba-cloud-sdk-js, dashscope) — наша цель кросс-совместимость, а не специализация.
- Не делать full-blown «AI playground» с историей сессий. Минимум: last request/response для диагностики.
- Не пытаться угадывать gateway автоматически по baseUrl — слишком хрупко.
- Не убирать `qwen-web` и обычный openai-compatible. Они работают, не трогаем.

## Метрики приёмки

- В настройках AI можно включить debug, нажать «Test prompt» и **увидеть полный request + response**;
- пресет `Qwen Corporate` доступен, при выборе взводит флаги `systemInUser` и `stripThinkTags`;
- при пустом ответе от openai-compatible провайдера автоматически делается 1 ретрай с `systemInUser`, в журнале запись;
- response с `<think>...</think>` (например от Qwen3) при `stripThinkTags: true` приходит в commit-input без think-тегов;
- `commitLanguage` сохраняется при переключении пресетов (тест);
- юзер на корпоративной Qwen может: включить debug → увидеть что system-prompt уходит → включить `systemInUser` → получить корректный коммит на нужном языке в Conventional Commits.

## Связано

- `docs/tasks/error-severity-system.md` — AI-ошибки (auth/network gateway) тоже должны проходить через severity-классификацию. После этой задачи `AiError` маппится в `ErrorSeverity` так же как git-ошибки.
- `docs/tasks/dialogs-unification.md` — AI Settings dialog должен использовать расширенный SgDialog (см. там пункт о миграции feature-диалогов).

## Запуск

Реализуй задачу из `docs/tasks/ai-provider-robustness.md`. Сначала debug-инструменты (юзер хотя бы увидит что происходит), потом переключатели, потом fallback. Без лишних вопросов.
