# STREAM C — CSP per-URL для AI + Coverage threshold (2026-05-11)

## Контекст

PROD CSP в `src/renderer/vite.config.ts` инжектит в HTML-meta строгий CSP, но
`connect-src` содержит широкий `https:` (комментарий внутри файла объясняет
почему: meta-CSP технически нельзя менять после загрузки, а AI-провайдеры
живут на разных доменах). Renderer сам HTTP в AI не дёргает — это делает
main process — но как defense-in-depth и страховка от будущих рефакторингов
вводим **HTTP-header CSP**, который накладывается поверх meta-CSP и
динамически разрешает ровно те origin'ы, которые соответствуют текущему
AiProviderConfig. HTML-meta CSP остаётся как есть.

Coverage сейчас не отслеживается threshold-ом. Зафиксировал baseline на
дату стрима и поставил gate с запасом 2% против шумовых флуктуаций.

---

## Часть 1 — CSP per-URL для AI

### Новый файл `src/main/cspOrigins.ts`

Pure-функция без side-effects (кроме `mainLogger.warn` на невалидном URL):

```typescript
export function computeAiOrigins(config: AiProviderConfig | null): string[]
```

Контракт по режимам:
- `null` / unconfigured → `[]`.
- `openai-compatible` + валидный baseUrl → `[new URL(baseUrl).origin]`.
  Поддерживает https (cloud) и http (Ollama localhost).
- `qwen-web` → всегда `['https://chat.qwen.ai']` (baseUrl игнорируется,
  AiConfigStore сохраняет его пустой строкой).
- Невалидный URL (например пользователь вбил мусор) → `[]` + warn в лог.
  **Не throw** — функция вызывается из webRequest hook на каждом response,
  падение хука сломает renderer.

Импортирует только типы из `src/core/ai/types.ts` и `mainLogger` из
`src/core/utils/Logger.ts`. Никакого Electron API в этом файле — он
тривиально юнит-тестится с моком electron'а.

### Изменения в `src/main/main.ts`

Дифф (что добавлено):

1. **Импорты:**
   ```typescript
   import { app, BrowserWindow, Menu, dialog, safeStorage, session, shell } from 'electron';
   // …
   import { computeAiOrigins } from './cspOrigins';
   ```

2. **Module-level переменная** для доступа к live AI-конфигу из webRequest hook:
   ```typescript
   let aiService: AiService | null = null;
   ```
   В `initServices()` присваивание `aiService = new AiService(aiStore.load())`
   вместо локального `const`. AiHandlers видит ту же ссылку (передаём в
   конструктор как раньше). При `aiSetConfig` IPC вызывает
   `aiService.setConfig(...)`, и hook на следующем response подхватит новый
   конфиг автоматически — без перерегистрации.

3. **Функция `registerCspHook()`** (вызывается один раз после `initServices`,
   до создания окна):
   - В dev (`!app.isPackaged`) **полностью пропускает** регистрацию hook'а.
     Иначе Vite HMR (ws://localhost:5188), `unsafe-inline`/`unsafe-eval` для
     Vite client скриптов и широкий connect-src ляжут под жёстким prod-CSP.
     В dev действует только HTML-meta DEV_CSP из `vite.config.ts`.
   - В prod регистрирует `session.defaultSession.webRequest.onHeadersReceived`,
     который инжектит CSP **только** для `file://`, `http://localhost:*`,
     `http://127.0.0.1:*`. На внешние домены (включая AI-API) hook ничего
     не делает — там CSP бессмыслен (потребляет main process через fetch,
     не renderer).
   - CSP-строка собирается в массиве для читаемости. Источники:
     ```
     default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
     img-src 'self' data:; font-src 'self' data:;
     connect-src 'self' <AI-origins-через-пробел>;
     object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
     ```
   - Если `aiOrigins` пуст (AI не настроен) — `connect-src 'self'` без
     дополнительных origin'ов. Renderer не сможет fetch'ить никуда наружу,
     но это и не нужно — AI-fetch'и идут из main.
   - Перед инжектом удаляются любые входящие `Content-Security-Policy`
     заголовки (case-insensitive), чтобы не было конкуренции (Electron при
     дублировании CSP применяет самый строгий, но проще быть единственным
     источником истины).

4. **Вызов** `registerCspHook()` после `initServices()` и проверки
   `aborted`, до `Menu.setApplicationMenu`.

### `tests/main/csp.test.ts` — 11 тест-кейсов

Все на чистую функцию `computeAiOrigins`. Список:

1. `null config` → `[]`, без warn.
2. `openai-compatible` + `https://api.openai.com/v1` → `['https://api.openai.com']`.
3. `openai-compatible` + `http://localhost:11434/v1` (Ollama) → `['http://localhost:11434']`.
4. `openai-compatible` + `https://api.deepseek.com/v1/` (trailing slash) → `['https://api.deepseek.com']`.
5. `openai-compatible` + custom port `https://proxy.corp:8443/api` → `['https://proxy.corp:8443']`.
6. `qwen-web` (стандарт) → `['https://chat.qwen.ai']`.
7. `qwen-web` с непустым baseUrl → всё равно `['https://chat.qwen.ai']` (baseUrl игнорируется).
8. Невалидный `baseUrl='not-a-url'` → `[]` без throw, с warn в лог.
9. `openai-compatible` без baseUrl (пустая строка) → `[]`, без warn.
10. `openai-compatible` с пробелами в baseUrl (`'   '`) → `[]`, без warn (trim).
11. `mode` не задан — дефолт `openai-compatible`, валидный URL → корректный origin.

Используется `vi.mock('electron', ...)` (как в `tests/utils/Logger.test.ts`)
чтобы logger не падал на отсутствии electron API. Никаких `any` —
типизировано через `AiProviderConfig`.

---

## Часть 2 — Coverage threshold

### Установлено

```bash
npm install --save-dev @vitest/coverage-v8
```

(добавлено 18 пакетов, в т.ч. `istanbul-lib-coverage`, `magicast` и др.)

### Baseline (2026-05-11)

Из `npm run test:coverage` после добавления csp.test.ts (494 теста):

```
Statements   : 49.9%   ( 1911 / 3829 )
Branches     : 49.88%  (  897 / 1798 )
Functions    : 40.34%  (  351 /  870 )
Lines        : 51.66%  ( 1752 / 3391 )
```

### Threshold в `vitest.config.ts`

Запас 2% против случайных флуктуаций, округление **вниз**:

| Метрика     | Baseline | -2%   | Threshold |
|-------------|----------|-------|-----------|
| statements  | 49.90%   | 47.90 | **47**    |
| branches    | 49.88%   | 47.88 | **47**    |
| lines       | 51.66%   | 49.66 | **49**    |
| functions   | 40.34%   | 38.34 | **38**    |

Конфиг:

```typescript
coverage: {
  provider: 'v8',
  include: ['src/core/**/*.ts'],
  exclude: ['src/core/git/types/**'],
  reporter: ['text', 'text-summary'],
  // baseline 2026-05-11: statements=49.9%, branches=49.88%, lines=51.66%, functions=40.34%
  thresholds: {
    statements: 47,
    branches: 47,
    lines: 49,
    functions: 38,
  },
},
```

`include` оставил `src/core/**/*.ts` — main/preload/renderer не входят в
coverage, как было до стрима. Поднимать scope = отдельная задача.

### Скрипт

`test:coverage` уже был в `package.json` (`vitest run --coverage`) —
дублировать не стал.

---

## Verify (всё зелёное)

| Команда                                          | Результат                            |
|--------------------------------------------------|--------------------------------------|
| `npm test`                                       | **494 passed** (483 + 11 новых csp)  |
| `npm run test:coverage`                          | проходит threshold (47/47/49/38)     |
| `npx tsc -p tsconfig.main.json --noEmit`         | **0 errors**                         |
| `npx tsc -p src/renderer/tsconfig.json --noEmit` | **0 errors**                         |
| `npm run lint`                                   | **0 errors**, 46 warnings (все — pre-existing, ни одного в новых файлах) |
| `npm run build`                                  | OK (renderer + main)                 |

Smoke-проверка `npm start`: пропущена сознательно (parent проверит сам, как
разрешено в задании). В dev-режиме hook отключён — Vite HMR не пострадает.
В prod hook регистрируется один раз и читает live `aiService.getConfig()`.

---

## Что не сделано и почему

- **Renderer HTML-meta CSP** не трогался (хард-запрет в задании). Header
  CSP из main process строго перекрывает его на нужные origin'ы; meta
  остаётся как defense-in-depth.
- **Расширение coverage scope на main/** — отдельная задача. Сейчас
  coverage считается только по `src/core/**/*.ts`, как было до стрима.
- **Pre-existing lint warnings (46 шт., все `any`)** — закрывает стрим B,
  как указано в задании. Новый `csp.test.ts` чист.
- **Тест на сам hook (не helper)** — не делал, потому что хук тесно
  завязан на Electron `session.webRequest`, мокать получится дорого и
  малопродуктивно (важная логика и так в `computeAiOrigins`, проверена
  11 кейсами). Smoke-сценарий покрывает интеграцию.
