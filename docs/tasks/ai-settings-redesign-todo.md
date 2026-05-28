# AI Settings — переход на многосекционное меню

> Сейчас `AiSettingsDialog` — плоский вертикальный список (preset, baseUrl,
> apiKey, model, language, advanced, debug). Это работает пока полей мало,
> но не масштабируется под:
> - кастомные промпты для 5 AI-фич (Commit Explainer, Stash naming,
>   Reflog, Conflict, Semantic search) — см. `ai-tier2-features-todo.md`;
> - per-feature toggle (включить/выключить отдельные фичи);
> - per-feature model override (например, дешёвая модель для stash naming,
>   дорогая для conflict analysis);
> - per-feature языковые/стилевые настройки.
>
> Нужно превратить диалог в **табы/sidebar-разделы** с группировкой по
> логическим зонам.

---

## Текущее состояние

**Файл:** `src/renderer/src/features/ai/AiSettingsDialog.tsx` (459 строк)

**Что есть:**
- Поля: mode, baseUrl, apiKey, qwenWebToken, model, commitLanguage
- 4 advanced-чекбокса: systemInUser, qwenDisableThinking, stripThinkTags, debugLogging
- Test connection + Test prompt + Show last debug
- Presets (cloud/local/web/corporate) + custom

**Хранилище:** `src/core/ai/AiConfigStore.ts` — атомарная запись в
`{userData}/ai-config.json`, ключи шифруются через `safeStorage`.
Формат `PersistedConfig` версия 2.

**Промпты:** жёстко зашиты в `src/core/ai/prompts.ts` (commit message
generation). Один промпт, нет пользовательских override.

---

## Целевая структура

### Sidebar-табы внутри диалога (left rail, ~160px):

1. **Подключение** (Connection) — текущие preset + baseUrl + apiKey + model
2. **Промпты** (Prompts) — список фич, для каждой текстовый промпт + reset
3. **Возможности** (Features) — toggles per-feature (commit msg, stash name,
   explainer и т.д.), каждая фича может быть включена/выключена
4. **Поведение** (Behavior) — language, system-in-user, strip-think-tags,
   и т.д. (сейчас в Advanced)
5. **Приватность** (Privacy) — глобальный toggle «отправлять код в LLM»,
   список запросов в дебаге, кнопка очистить debug
6. **Диагностика** (Debug) — test connection, test prompt, snapshot
   последнего запроса, debugLogging toggle

Каждый таб — отдельный компонент в `src/renderer/src/features/ai/sections/`.

### Размер диалога
- Сейчас `size="lg"` (720px). Под табы нужен `size="xl"` (920px) —
  слева sidebar 160px, справа scrollable content 760px.

### Сохранение
- Один общий `handleSave` — собирает payload из всех табов.
- Dirty-флаг: showing «Несохранённые изменения» в шапке, если что-то
  поменялось но не нажат Save.
- При переключении табов с unsaved — confirm-dialog «Сохранить или
  отбросить?» (или auto-save по blur, нужно решить).

---

## Расширение конфига

### `PersistedConfig` v3

Добавить новые поля (обратная совместимость через `version`):

```ts
interface PersistedConfig {
  version: 3;
  // существующие поля (mode, baseUrl, model, …)

  /** Кастомные промпты, перекрывающие defaults из prompts.ts. */
  prompts?: {
    commitMessage?: string;
    explainCommit?: string;
    stashName?: string;
    explainReflog?: string;
    analyzeConflict?: string;
  };

  /** Включение/выключение фич. По умолчанию commit message ON,
      остальные — OFF (пока не реализованы). */
  features?: {
    commitMessage?: boolean;
    explainCommit?: boolean;
    stashName?: boolean;
    explainReflog?: boolean;
    analyzeConflict?: boolean;
    semanticSearch?: boolean;
  };

  /** Per-feature model override. Если не задан — используется default. */
  modelOverrides?: {
    commitMessage?: string;
    explainCommit?: string;
    stashName?: string;
    // …
  };

  /** Глобальный privacy toggle. Если false — все AI-фичи блокируются
      (UI показывает кнопки, но клик даёт «AI отключён в настройках»). */
  aiEnabled?: boolean;

  /** Если false — не отправлять diff/code в зарубежные провайдеры.
      Локальные (Ollama / LM Studio), российские (YandexGPT / GigaChat) и
      без-VPN (Qwen, DeepSeek) — всегда разрешены, не подпадают под
      это ограничение. Для свежих установок default = false (GitBor —
      продукт для импортозамещения, не разрешаем отправку «по тихому»). */
  allowCloudCodeShare?: boolean;

  /** Язык ответа AI — общий для всех фич, заменяет старое commitLanguage.
      'auto' = язык UI (`getLang()`). Промпты внутри всегда на английском
      (см. DEFAULT_PROMPTS), это улучшает качество reasoning у моделей.
      Финальный ответ — на этом языке через инструкцию в конце промпта. */
  aiResponseLanguage?: 'auto' | 'en' | 'ru';
}
```

### Миграция v2 → v3

```ts
function migrate(p: PersistedConfig): PersistedConfig {
  if (p.version === 2) {
    return {
      ...p,
      version: 3,
      features: { commitMessage: true },
      aiEnabled: true,
      // Для импортозамещающего продукта default = НЕ отправлять в облако.
      // Юзер должен явно включить отправку, понимая последствия.
      allowCloudCodeShare: false,
      // Перенос старого commitLanguage → нового унифицированного поля.
      aiResponseLanguage: p.commitLanguage ?? 'auto',
    };
  }
  return p;
}
```

### Промпты — defaults на английском + language toggle

`src/core/ai/prompts.ts`:

```ts
// Промпты на английском намеренно: LLM-модели лучше делают reasoning
// на английском (это их основной язык обучения), даже если конечный
// ответ нужен на русском. Язык ответа добавляется отдельной инструкцией
// в конце промпта через resolvePrompt.
export const DEFAULT_PROMPTS: Record<PromptId, string> = {
  commitMessage: `You are a senior git user. Generate a concise commit message...`,
  explainCommit: `You are a code reviewer. Explain this commit in 3-5 sentences...`,
  stashName: `Suggest a short (3-7 words) git stash name for this diff...`,
  explainReflog: `Convert git reflog into a human-readable timeline...`,
  analyzeConflict: `This is a git merge conflict. Explain in simple words...`,
};

export type PromptId = keyof typeof DEFAULT_PROMPTS;

const LANGUAGE_NAMES: Record<'en' | 'ru', string> = {
  en: 'English',
  ru: 'Russian',
};

export function resolvePrompt(id: PromptId, cfg: AiProviderConfig): string {
  const base = cfg.prompts?.[id] ?? DEFAULT_PROMPTS[id];
  const lang = resolveResponseLanguage(cfg);
  // Английский ответ = native, инструкцию добавлять не нужно.
  if (lang === 'en') return base;
  return `${base}\n\nIMPORTANT: Respond strictly in ${LANGUAGE_NAMES[lang]}. Do not switch language mid-response.`;
}

function resolveResponseLanguage(cfg: AiProviderConfig): 'en' | 'ru' {
  const setting = cfg.aiResponseLanguage ?? 'auto';
  if (setting !== 'auto') return setting;
  return (getLang() === 'ru' ? 'ru' : 'en');
}
```

`AiService.generateCommitMessage` начинает использовать `resolvePrompt('commitMessage', cfg)` вместо хардкода.

---

## UI-компоненты по табам

### `ConnectionSection.tsx`

**Группы пресетов (порядок — приоритет для GitBor как импортозамещающего продукта):**

```
1. Локальные — данные не покидают компьютер
   • Ollama
   • LM Studio
   • Llama.cpp server
2. Корпоративные — self-hosted / внутренний gateway
   • Qwen Corporate
   • Custom OpenAI-compatible
3. Доступные без VPN
   • Qwen Web
   • Qwen API (Alibaba Cloud)
   • DeepSeek
4. Российские
   • YandexGPT (через Yandex Cloud, OpenAI-compatible endpoint)
   • GigaChat (Сбер) — отдельный provider, требует OAuth (если сложно → backlog)
5. Зарубежные (могут требовать VPN)
   • OpenAI
   • Anthropic
   • Groq
```

Default preset для пустого конфига — **Ollama** (не OpenAI как было). Локальные первыми и в dropdown'е, и в логике auto-detect.

**Почему такой порядок:**
- **Корпоративные на 2-м месте** — в крупных компаниях разработчик
  часто вообще не имеет выбора кроме внутреннего LLM-gateway
  (security policy блокирует публичные API). По уровню контроля данных
  это ближе к локальным, чем к публичному облаку.
- **Российские на 4-м, не на 2-м** — YandexGPT/GigaChat требуют
  регистрации в Yandex Cloud / Sber API (с паспортом, договором),
  тогда как Qwen и DeepSeek доступны без VPN сразу после
  регистрации. Для импортозамещения важнее «нет VPN и нет
  бюрократии», чем «российский флаг».

- Preset dropdown с группами выше.
- Mode-зависимые поля (baseUrl + apiKey **или** qwenWebToken).
- Model input/select (с подсказкой о рекомендуемой модели для preset'а).
- Test connection button + status.

**Новые пресеты (план):**
- `yandexgpt` — `baseUrl: https://llm.api.cloud.yandex.net/v1`, модели:
  `yandexgpt-lite`, `yandexgpt`, `yandexgpt-pro`. Авторизация через API key
  Yandex Cloud. OpenAI-compatible.
- `gigachat` — отдельный provider `GigaChatProvider` (OAuth-токен через
  Sber API). Если в MVP не вписывается — записать в backlog отдельной
  задачей и в UI пометить «coming soon».

### `PromptsSection.tsx`
- Список фич с textareas:
  ```
  ┌─ Commit message ────────────────────┐
  │ [textarea с текущим промптом, EN]   │
  │ Переменные: {diff}, {branch}        │
  │ [Reset to default]  [Test]          │
  └─────────────────────────────────────┘

  ┌─ Stash name suggestion ─────────────┐
  │ ...
  ```
- Каждая текстарея — monospace, 6-10 строк, autosize.
- **Defaults на английском** — это сознательное решение, не оставлять
  редактору ощущение «надо переписать на свой язык». В шапке секции
  написать: «Промпты на английском улучшают качество reasoning у LLM.
  Финальный ответ переводится через настройку "Язык ответа AI" в
  разделе Поведение.»
- «Test» — отправляет промпт с фейковым контекстом (тот же mock-diff),
  показывает результат рядом.
- «Reset» — возвращает текст из `DEFAULT_PROMPTS[id]`.
- Переменные подсказываются плейсхолдером и в hint.

### `FeaturesSection.tsx`
- Список фич с toggle:
  - ✅ Commit message generation (реализовано)
  - ☐ Explain commit (Tier 2, недоступно если не реализовано)
  - ☐ Stash name suggestion
  - ☐ Explain reflog
  - ☐ Analyze conflict
  - ☐ Semantic search
- Каждая фича — короткое описание + опциональный model-override input.
- Неимплементированные фичи — disabled checkbox + бейдж «coming soon».

### `BehaviorSection.tsx`
- **Язык ответа AI** (`aiResponseLanguage`) — Авто / Русский / English.
  Один общий toggle для всех AI-фич (заменяет старое `commitLanguage`,
  которое касалось только commit messages). Hint: «Промпты внутри
  отправляются на английском (для качества reasoning), ответ — на
  выбранном языке.»
- System-in-user.
- Qwen disable thinking.
- Strip think tags.
- Стиль commit-сообщения (Conventional / Plain / Custom) — новая фича,
  не связана с языком (это про формат типа `feat(scope): ...`).

### `PrivacySection.tsx`
- ☐ AI включён (global kill-switch). Default = true.
- ☐ Разрешить отправку кода в **зарубежные** провайдеры.
  **Default для новых установок = false**. Текст: «Включает OpenAI,
  Anthropic, Groq, DeepSeek US. **Не включает (всегда разрешено):
  локальные провайдеры (Ollama / LM Studio), российские (YandexGPT /
  GigaChat), Qwen и другие без-VPN.** ВАЖНО: данные кода будут
  отправлены на серверы вне юрисдикции РФ.»
- Список последних N запросов (timestamp + feature + bytes sent +
  пометка юрисдикции 💻 LOCAL / 🇷🇺 RU / 🌐 CN / 🌍 US).
  Кнопка «Очистить».
- Ссылка «Что отправляется в LLM?» → markdown-описание.

### `DebugSection.tsx`
- ☐ Debug logging.
- Test prompt + show last (как сейчас).
- Snapshot последнего запроса (полный body).
- Кнопка «Экспорт debug-лога» (json).

---

## Реализационный план

### Шаг 1: Структура
- [ ] Создать `src/renderer/src/features/ai/sections/` с шестью файлами-заглушками.
- [ ] Превратить `AiSettingsDialog.tsx` в layout-обёртку с табами слева
      и `{ActiveSection}` справа.
- [ ] Перенести existing-логику (connection) в `ConnectionSection.tsx`.
- [ ] Перенести existing advanced → `BehaviorSection.tsx`.
- [ ] Перенести existing debug → `DebugSection.tsx`.

После шага 1 ничего нового — просто разбили существующий диалог. Тесты
не ломаются. Один коммит.

### Шаг 2: Промпты
- [ ] Расширить `prompts.ts` — добавить `DEFAULT_PROMPTS` и `resolvePrompt`.
- [ ] Расширить `AiProviderConfig` — поле `prompts`.
- [ ] Расширить `AiConfigStore` — миграция v2 → v3, save/load `prompts`.
- [ ] `PromptsSection.tsx` — список textareas, reset, test.
- [ ] Refactor `AiService.generateCommitMessage` — использовать
      `resolvePrompt`, не хардкод.

После шага 2 — пользователь может править промпт commit message. Остальные
промпты — пустые заглушки (фичи ещё не реализованы).

### Шаг 3: Features + Privacy
- [ ] `AiProviderConfig.features`, `aiEnabled`, `allowCloudCodeShare`.
- [ ] `FeaturesSection.tsx` — list of toggles.
- [ ] `PrivacySection.tsx` — kill-switch + cloud toggle.
- [ ] В `AiService` проверять `features[id]` перед вызовом фичи.
- [ ] В UI (AI-кнопки) — скрывать/disable если `features[id] === false`.

### Шаг 4: Per-feature model override
- [ ] `AiProviderConfig.modelOverrides`.
- [ ] В UI секции «Возможности» добавить input для model рядом с
      каждым toggle (collapsible).
- [ ] `AiService` использует override если задан.

### Шаг 5: Polish
- [ ] Dirty-флаг + confirm на смену таба.
- [ ] Тестирование на разных провайдерах.
- [ ] Обновление i18n (en/ru) — все новые ключи.
- [ ] Обновление docs (`docs/features.md`, `docs/architecture.md`,
      `gitbor-web` доки).

---

## Архитектурные решения

### Один диалог vs главное меню «Settings»
**Решение:** оставить один диалог, но с табами внутри. Главное меню
Settings сейчас работает как hub, не нужно множить points of entry.

### Где хранить промпты — файл или встроенные строки
**Решение:** defaults в коде (`prompts.ts`), пользовательские — в
`ai-config.json`. Не делаем экспорт/импорт промптов как отдельные файлы
(сложность без явной пользы). Если фича прорастёт — добавим позже.

### Что делать с unsaved при закрытии диалога
**Решение:** confirm-dialog «Сохранить?» / «Отбросить?» / «Отмена».
Не auto-save (юзер ожидает явного Save в админ-настройках).

### Per-feature model — overkill?
**Решение:** добавить, но скрыть под «Дополнительно» в каждой фиче.
Default — без override (использует основной model). Это решает кейс
«дешёвая модель для stash naming, дорогая для conflict».

### Privacy toggle — нужен ли?
**Решение:** да, обязательно. Без него мы не можем добавлять облачные
explainer-фичи безопасно для энтерпрайз-юзеров. Это **главный barrier**
для adoption в корпорациях.

---

## Связь с другими тасками

- **`ai-tier2-features-todo.md`** — реализация 5 AI-фич, для которых
  нужны кастомные промпты, toggles и model-override. Privacy-секция,
  per-feature toggles и `resolvePrompt(id, cfg)` живут **здесь**,
  не в Tier-2 — это разделение «как настраивать» vs «что делает».
- Этот redesign — **prerequisite** для большинства фич из Tier-2.
  Шаги 1-2 (структура + промпты) обязательны до первой фичи Tier-2,
  иначе придётся хардкодить промпты в `prompts.ts` без UI.
- Шаги 3-4 (Features + per-feature model) можно делать параллельно
  с реализацией Commit Explainer.

---

## Что НЕ делать

- НЕ ломать обратную совместимость `ai-config.json` v2 — миграция
  должна молча подставить defaults.
- НЕ требовать перезапуска при смене настроек. Все hot-reload.
- НЕ показывать неимплементированные фичи как «работающие». Disabled
  + «coming soon» бейдж.
- НЕ дублировать настройки между табами. Каждое поле живёт в одном месте.
- НЕ давать редактировать system-в-user через free-form для qwen-web
  mode (там нет прямого API над промптом).
