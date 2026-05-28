# AI Tier-2 — точечные ассистенты поверх данных GitBor

> **Позиционирование:** GitBor НЕ конкурирует с Cursor / GitButler / Aida в
> «AI разрешает merge». Это проигрышная гонка — у конкурентов глубже
> интеграция с кодом и доступ к Claude/GPT-4. Вместо этого делаем 5
> маленьких AI-инструментов поверх данных, которые GitBor УЖЕ парсит:
> diff, commit message, file history, reflog, working copy.
>
> Главный принцип: **AI — объяснитель, не actor.** Не «AI делает X», а
> «AI рассказывает что происходит / предлагает». Меньше галлюцинаций,
> выше доверие, работает на дешёвой/локальной модели (Qwen, Llama).

---

## Связанные таски

- **`ai-settings-redesign-todo.md`** — переход AI Settings на табы,
  расширение конфига (`prompts`, `features`, `modelOverrides`,
  `aiEnabled`, `allowCloudCodeShare`), `resolvePrompt(id, cfg)`.
  **Prerequisite** для этой таски: шаги 1-2 Redesign'а (структура +
  промпты) должны быть готовы до первой фичи. Иначе промпты пришлось
  бы хардкодить в `prompts.ts` без override и без UI для настройки.

## Контекст: что уже есть в проекте

- `src/core/ai/` — провайдеры (`OpenAiCompatibleProvider`, `QwenWebProvider`),
  `AiService`, конфигурация (`AiConfigStore`), генерация commit-message.
- IPC: `aiGenerateCommitMessage`, `aiCancelGenerate`, `aiGetConfig`,
  `aiSetConfig`, `aiTestConnection`, `aiError`.
- UI: `AiGenerateButton`, `AiSettingsDialog`, отмена через `aiCancelGenerate`.

Все 5 фич должны:
1. Переиспользовать существующий `AiService` (никаких новых SDK).
2. Опциональные — выключены если `features[featureId] === false` или
   `aiEnabled === false` (см. Settings Redesign, шаг 3).
3. С отменой (длинная генерация — кнопка Cancel).
4. Streaming (если провайдер поддерживает) — токены прилетают по мере
   генерации, не блокируют UI.
5. Промпт берётся через `resolvePrompt(id, cfg)` — не хардкодить.
6. Localized (en/ru) на уровне UI-копий (кнопки, заголовки, ошибки).

### Язык промптов и ответов

**Defaults — на английском.** Это намеренно: LLM (включая локальную
Qwen и YandexGPT) делает reasoning лучше на английском. Все промпты в
`DEFAULT_PROMPTS` пишем на английском.

**Язык ответа — через общую настройку** `aiResponseLanguage` (см.
Settings Redesign / `BehaviorSection`). `resolvePrompt(id, cfg)`
добавляет в конец промпта инструкцию `Respond strictly in Russian`
(если выбран русский). Поэтому в промпт фичи **не пишем** что-то типа
«ответь на русском» — это уже добавится автоматически.

**Исключение:** `stashName` — всегда выводит на английском (это git-имя,
не для человека), игнорирует `aiResponseLanguage`.

При проверке фичи на дешёвых моделях прогнать **оба** языка ответа
(ru / en) — поведение должно быть стабильным на обоих.

---

## Фича 1: AI-объяснение коммита/PR (Commit Explainer)

**Польза:** Открыл чей-то коммит → нажал «Объяснить» → LLM смотрит
diff + subject + body + историю файла → пишет человеческое описание
«что сделали и зачем».

**Где:** Кнопка в `CommitDetails` рядом с subject. Открывает inline-блок
с потоковым текстом объяснения.

**Промпт (default на английском, см. ai-settings-redesign — `DEFAULT_PROMPTS`):**
```
You are a senior code reviewer. Explain this commit in 3-5 sentences:
- what changed (high-level, not line-by-line);
- the likely intent of the author;
- anything a reviewer should pay attention to.

Subject: {subject}
Body: {body}

Diff:
{diff}
```
Язык ответа — через `aiResponseLanguage` (см. Settings Redesign).

**Данные (уже есть):** `getCommitDetails(hash)` возвращает subject, body,
files. `getFileDiff(hash, file)` — patch. Никаких новых IPC.

**Файлы:**
- `src/core/ai/AiService.ts` — метод `explainCommit(hash): AsyncIterable<string>`.
- `src/core/ai/prompts.ts` — добавить ключ `explainCommit` в `DEFAULT_PROMPTS`.
  Промпт берётся через `resolvePrompt('explainCommit', cfg)` — пользователь
  может переопределить через AI Settings (PromptsSection).
- `src/core/bridge/messages.ts` — IPC `aiExplainCommit { hash }`,
  событие `aiExplanationToken { text }`.
- `src/renderer/src/features/details/CommitDetails.tsx` — кнопка + панель.
  Кнопка показывается только если `features.explainCommit !== false`.
- i18n: `ai.explainCommit`, `ai.explainCommitTooltip`, `ai.explaining`.

**Перф:** Diff может быть огромным (rename 1000 файлов). Лимит ~50KB
patch, иначе truncate с пометкой «… X файлов опущено».

**Риски:** Галлюцинации на больших мерж-коммитах. Mitigation: явно
предупреждать «AI-объяснение, может ошибаться. Всегда проверяйте код».

---

## Фича 2: AI smart-stash naming

**Польза:** Жмёшь «Отложить» → LLM смотрит на diff working copy →
предлагает осмысленное имя вместо `WIP on main: abc1234`.

**Где:** В `StashDialog` рядом с полем имени — кнопка «✨ Предложить».
По клику запрос → имя автоматически вставляется в input.

**Промпт:**
```
Suggest a short (3-7 words) name for a git stash based on this diff.
Output only the name itself, no quotes, no punctuation at the end.

Diff:
{diff}
```
Это единственная фича, где ответ должен быть **всегда на английском**
(stash-имя обычно короткое и идёт в git, не для пользователя). Игнорируем
`aiResponseLanguage` для этого промпта — в `resolvePrompt` сделать
исключение для `stashName` или захардкодить инструкцию в самом промпте.

**Данные (уже есть):** Текущий unstaged + staged diff из `state.localChanges`.
Получить через `getFileDiff(null, file)` для каждого изменённого файла.

**Файлы:**
- `AiService.ts` — `suggestStashName(diff): Promise<string>`.
- IPC: `aiSuggestStashName`, ответ синхронный (короткий текст ~50 символов).
- `StashDialog.tsx` — кнопка suggest рядом с input.
- i18n: `stashDialog.aiSuggest`, `stashDialog.aiSuggesting`.

**Edge cases:**
- Пустой diff → не показывать кнопку.
- Слишком большой diff (>30KB) → truncate первыми N файлами.
- Пользователь жмёт suggest при заполненном поле → spinner, по готовности
  заменяет содержимое (с возможностью undo через Ctrl+Z).

---

## Фича 3: AI semantic search по истории

**Польза:** «Найди когда я в последний раз менял такую логику».
Поиск по смыслу, не по тексту. Использует эмбеддинги локально (или
через тот же AI-провайдер, если он умеет embeddings).

**Где:** В Graph header — search-input с префиксом `:semantic` или
отдельная кнопка-режим «🔎 AI». Результаты — список коммитов с
ranked similarity score.

**Подход:**
1. Индексация (фоновая, lazy): для каждого коммита генерируем embedding
   subject + body (короткий вектор). Кэш в SQLite/JSON в `.git/gitbor/`.
2. При запросе: embedding запроса → cosine similarity по индексу →
   top-20 коммитов.

**Что НЕ делать:**
- НЕ индексировать сразу 50k коммитов на open repo — фоновый процесс
  с throttle 100 коммитов/сек.
- НЕ слать в облако каждое сообщение — батчинг по 50 штук.
- НЕ блокировать UI — индексация в worker_threads.

**Файлы:**
- `src/core/ai/EmbeddingIndex.ts` — новый сервис: index, search, persist.
- `src/core/ai/providers/base.ts` — добавить опциональный `embed(text): vector`.
- IPC: `aiSemanticSearch { query }`, `aiIndexProgress { done, total }`.
- UI: новый компонент `SemanticSearchPanel`.
- i18n: соответствующие ключи.

**Риск:** Не все провайдеры дают embedding API (Qwen Web не даёт).
Fallback: использовать tf-idf или просто LLM-rerank top-100 из обычного
`git log --grep`. Это работает чуть хуже, но не требует embeddings.

**Это самая дорогая фича из пяти** — нужна отдельная итерация на
архитектуру (storage, lazy indexing, инвалидация при новых коммитах).
Возможно отложить до тех пор, пока остальные не приживутся.

---

## Фича 4: AI-объяснение reflog

**Польза:** Reflog нечитаем для большинства (`HEAD@{12}: rebase (start):
checkout refs/heads/main`). LLM преобразует в человеческий timeline:
«Вчера в 18:30 ты сделал rebase из main, потерял 3 коммита, вот они».

**Где:** В существующем диалоге Reflog (если есть) или новой панели.
Toggle «Объяснить AI» рядом с raw-видом.

**Промпт:**
```
Convert this git reflog into a human-readable timeline:
- group adjacent actions (5 reflog lines may be 1 event);
- mark "lost commits" (when HEAD moves without a commit);
- if something looks like a mistake, suggest recovery commands.

Reflog:
{reflog}
```
Язык ответа — через `aiResponseLanguage`.

**Данные:** `getReflog()` уже есть в IPC.

**Файлы:**
- `AiService.ts` — `explainReflog(entries): AsyncIterable<string>`.
- IPC: `aiExplainReflog`.
- UI: панель в reflog-диалоге.
- i18n.

**Edge:** Большой reflog (1000+ записей) → передавать только последние 100.

---

## Фича 5: Conflict-помощник (объяснитель, НЕ actor)

**Польза:** При конфликте — AI **объясняет**, что делают разные стороны,
и подсвечивает риск. **НЕ применяет** изменения автоматически.

**Где:** В существующем merge-editor — новая боковая панель «AI-анализ».
Для каждого conflict-hunk:
- одной строкой: «Левая делает X, правая — Y»;
- риск-метка: low / medium / high (только эвристика, не auto-pick);
- кнопка «Объяснить подробнее» → streaming explanation.

**Промпт:**
```
This is a git merge conflict. Explain in simple words:
1. What the HEAD version does (3-5 words).
2. What the MERGE version does (3-5 words).
3. Merge risk: low / medium / high. Why.

IMPORTANT: do NOT propose a merged solution. Only describe.

HEAD:
{ours}

MERGE:
{theirs}

BASE:
{base}
```
Язык ответа — через `aiResponseLanguage`.

**Данные (уже есть):** `getConflictContent(file)` парсит маркеры
`<<<< ==== >>>>`, отдаёт `ours/theirs/base`.

**Файлы:**
- `AiService.ts` — `analyzeConflict(hunk): AsyncIterable<string>`.
- IPC: `aiAnalyzeConflict`.
- UI: панель в `MergeEditor`.
- i18n.

**Принципиальное ограничение:** AI **не** генерирует merged-версию. Это
**сознательное** решение — модель не имеет полного контекста (тесты,
архитектура, business intent), и автомерж от LLM на проде = баги.
Conservative подход = доверие пользователей.

---

## Общие архитектурные принципы

### Стриминг и отмена
- Все длинные операции (`explainCommit`, `explainReflog`, `analyzeConflict`)
  — через `AsyncIterable<string>` + event `aiToken { text, requestId }`.
- Кнопка Cancel: `aiCancel { requestId }`.
- На стороне renderer: накапливаем токены в локальный state, рендерим
  как markdown по мере прихода.

### Дешёвая модель
- Все промпты проверить на Qwen 7B / Llama 8B — должны давать осмысленный
  результат. Если требуют GPT-4 — фича не пройдёт.
- Длина промптов лимитирована (~4k токенов вместе с diff).
- Per-feature model override (через Settings Redesign шаг 4) — если
  пользователь хочет использовать более дешёвую модель для stash naming
  и более дорогую для conflict analysis.

### Privacy и UI-настройка
См. `ai-settings-redesign-todo.md` (PrivacySection, FeaturesSection,
PromptsSection). Конкретно:
- глобальный kill-switch (`aiEnabled`),
- разрешение отправки в облако (`allowCloudCodeShare`),
- per-feature toggle (`features[id]`),
- кастомный промпт (`prompts[id]`) с дефолтом из `DEFAULT_PROMPTS[id]`.

Перед каждым AI-вызовом из renderer'а проверять `features[id]` и
`aiEnabled`. Если облачный провайдер и `allowCloudCodeShare === false`
— фича блокируется с понятным сообщением «Включите cloud-sharing в
настройках или используйте локальный провайдер».

### Тестирование
- Mock `AiService` для unit-тестов компонентов.
- E2E с моковым стримом (не реальный LLM в тестах).

---

## Приоритеты

| # | Фича | Сложность | Польза | Очерёдность |
|---|------|-----------|--------|-------------|
| 1 | Commit Explainer | низкая | высокая | **1-я итерация** |
| 2 | Smart stash naming | низкая | средняя | **1-я итерация** |
| 4 | Reflog Explainer | средняя | высокая | 2-я итерация |
| 5 | Conflict-помощник | средняя | высокая | 2-я итерация |
| 3 | Semantic search | высокая | средняя | отложить, оценить позже |

---

## Что НЕ делать

- НЕ позиционировать GitBor как «AI git клиент». Это узкий тег и
  проигрышная гонка.
- НЕ автоматически отправлять данные в LLM без клика пользователя.
- НЕ давать AI применять изменения (merge, commit message override,
  conflict resolution). Только предлагать.
- НЕ полагаться на дорогие модели (GPT-4) — фичи должны работать на
  дешёвой/локальной модели.
- НЕ делать «AI решает» — делать «AI объясняет».
