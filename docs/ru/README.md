# GitBor

> English version: [README.md](../../README.md)

Бесплатный кросс-платформенный десктоп Git-клиент на Electron.
Альтернатива Fork / GitKraken / SourceTree. Исходный код под лицензией MIT,
но репозиторий публично не размещён.

Часть экосистемы Sky Platform.

## Скриншот

Главное окно: граф коммитов, сайдбар веток (русский UI), просмотр диффа.

![GitBor — главное окно](../images/gitbor-screenshot.png)

---

## Быстрый старт

```bash
cd gitbor
npm install
npm run dev
```

`npm run dev` через `concurrently` запускает Vite (renderer на порту 5188)
и Electron (main process).

### Сборка

```bash
npm run build        # Сборка renderer + main
npm start            # Запуск собранного приложения
```

### Тесты и линтинг

```bash
npm test             # Все тесты (Vitest)
npx vitest           # Watch-режим
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier format
```

### Дистрибутивы

```bash
npm run dist:win     # Windows (NSIS + portable)
npm run dist:mac     # macOS (DMG)
npm run dist:linux   # Linux (AppImage + deb)
```

---

## Стек

| Компонент | Технология |
|-----------|-----------|
| Десктоп-рантайм | Electron 40 |
| UI | React 18, TypeScript 5.9, Vite 6 |
| Стили | CSS Modules, `--sg-*` custom properties |
| Файловый watcher | chokidar 4 |
| Тесты | Vitest 4.1 (unit), Playwright 1.59 (E2E, Windows) |
| DX | husky 9 + lint-staged 17 (pre-commit) + `npm test` (pre-push), `npm run analyze` (rollup-plugin-visualizer) |
| Git | Бандленный git-бинарь (`resources/git/{platform}/git`) |

---

## Архитектура

4 слоя, зависимости текут только вниз:

```
┌──────────────────────────────────────────────────────────┐
│  Renderer Process (React)                                │
│  UI: Menu, Sidebar, Graph, Changes, Diff, Merge, SSH     │
├──────────────────────────────────────────────────────────┤
│  Preload Script                                          │
│  contextBridge (защищённый IPC мост)                     │
├──────────────────────────────────────────────────────────┤
│  Main Process (Node.js)                                  │
│  Application + Safety + Git Layer + SSH Key Manager      │
├──────────────────────────────────────────────────────────┤
│  Bundled Git                                             │
│  resources/git/{platform}/git                            │
└──────────────────────────────────────────────────────────┘
```

### Поток данных

```
App.tsx → api.invoke() → preload (ipcRenderer) → MessageBridge (ipcMain)
  → CommandHandler → GitExecutor → git-бинарь
```

Полная структура проекта, перечень всех модулей и тестов — в [английской версии README](../../README.md#project-structure).

---

## Ключевые возможности

- **Граф коммитов** — виртуализированный скролл, раскрашивание веток, поиск
- **Сайдбар Branch/Tag/Stash** — древовидный вид, checkout, merge, переименование, удаление; текущая ветка отмечена зелёной точкой
- **Локальные изменения** — древовидный вид, stage/unstage/discard по файлу и по hunk
- **Контекстное меню папки** — stage / unstage / discard / delete для всех файлов внутри (секции Staged/Unstaged)
- **Diff viewer** — inline + split, игнор пробелов, stage hunk; без `+`/`−` префикса в тексте строк (только цвет)
- **Разрешение конфликтов merge** — двухколоночный редактор, авто-переход, предсказание конфликтов
- **История файла и git blame** — история коммитов по файлу, построчные аннотации
- **Интерактивный rebase** — pick/reword/edit/squash/fixup/drop, баннер прогресса
- **Multi-repo вкладки** — независимые engine'ы по репо, вкладка `+` открывает RepoManager; открытые вкладки и активная восстанавливаются при следующем запуске
- **Repository Manager** — недавние репо, open/clone/init; доступен через вкладку `+` или повторный клик по активной
- **AI commit messages** — генерация в один клик из staged diff; OpenAI-совместимые провайдеры (OpenAI/Ollama/LM Studio/DeepSeek/Groq) и Qwen Web (chat.qwen.ai session token); язык коммита `auto`/`en`/`ru`
- **Кастомное меню** — HTML/CSS меню с Edit-командами, горячими клавишами (без нативного меню)
- **SSH Keys Manager** — генерация, просмотр, копирование, удаление SSH-ключей
- **Repository Settings** — user.name/email, переключатель global/local
- **Диалог stash** — поле имени с пустым значением (пустое = `git stash` без `-m`)
- **Toast-уведомления** — success/error feedback для всех git-операций
- **Диалоги подтверждения** — деструктивные действия требуют подтверждения
- **Shell-интеграция** — открыть в Explorer/Terminal, обновить (F5)
- **Error boundary** — React ErrorBoundary не даёт показать белый экран
- **Журнал git-активности** — журнал git-вызовов по репо (start/append/finish, cap 100, stdout/stderr обрезаются до 16 KiB)
- **Статистика репозитория** — контрибьюторы, code stats с кэшированными heatmap-картами по автору
- **Reflog** — история HEAD с восстановлением
- **Git Bisect** — интерактивный бинарный поиск багнутых коммитов
- **Git Hooks** — просмотр и включение/выключение хуков
- **Подписанные коммиты** — GPG/SSH verification badges в графе
- **Worktrees** — управление множеством рабочих деревьев
- **Git LFS** — отслеживание больших файлов
- **.gitignore editor** — шаблоны для Node, Python, Java, Rust, Go, IDE, OS
- **Сравнение двух коммитов** — diff между произвольными коммитами
- **Навигация стрелками** — ↑/↓ в графе коммитов
- **i18n** — английский и русский (каждая UI-строка покрыта `i18n.test.ts`)
- **Темы** — тёмная и светлая
- **Дистрибуция** — electron-builder для Win/Mac/Linux

---

## Multi-Repo движок

Каждое открытое репо — полностью независимый набор сервисов; долгий
`git pull` на репо A никогда не блокирует операции на репо B.

- **`RepoServicesRegistry`** — `Map<repoPath, { git, queue, safety }>`. `acquire(repoPath)` лениво создаёт сервисы с `cwd`, зафиксированным при конструировании; `release(repoPath)` шлёт SIGTERM только inflight-процессам этого репо.
- **`StateManager`** = фасад над тремя слоями:
  - `RepoSlicesStore` — `slicesByRepo: Map<repoPath, RepoSlice>` + общий `meta` (`openRepos`, `activeRepoIndex`).
  - `RepoStateRefresher` — все асинхронные `refresh*` методы, с гардом `isRepoTracked(repoPath)`, чтобы фоновый refresh не воскресил только что закрытое репо.
  - `RepoEventBus` — три канала подписки (state / switch / close).
- **WorkerPool** — 2 `worker_threads`, round-robin, авто-respawn. `parseStatus`/`parseCommits`/`computeGraphLayout` уходят в воркеры, когда вход превышает пороги (status > 256 KB, log > 512 KB, layout > 2000 коммитов).
- **Зеркало в renderer** — `useAppState` это фасад над `useRepoSlices` / `useRunningOps` / `useStateSubscription`. `state.isOperationRunning` и `state.currentOperation` берутся только из активной вкладки — fetch на A не дизейблит кнопки на B.
- **Дедупликация `graphData`** — `MessageBridge.sentGraphByRepo` пропускает emit одинаковых layout-payload'ов, так что переключение A→B→A не толкает мегабайты JSON через IPC.

## AI модуль

- **Провайдеры**:
  - `OpenAiCompatibleProvider` — `/v1/chat/completions` с SSE-стримингом, используется для OpenAI, Ollama, LM Studio, DeepSeek, Groq.
  - `QwenWebProvider` — неофициальный мост к `chat.qwen.ai` через session-токен из `localStorage` (DashScope API-ключ не нужен).
- **`AiConfigStore`** — `{userData}/ai-config.json`, атомарная запись, API-ключ / Qwen-токен шифруются через Electron `safeStorage` (DPAPI / Keychain / libsecret); fallback на префикс `plain:`, когда key store недоступен.
- **`AiHandlers`** — `AbortController` per-`requestId`, `cancelAll()` при shutdown, маскирование секретов (`••••••••`) в `getConfig` для UI.
- **Промпты** — system + user промпты с языком коммита `auto`/`en`/`ru`; diff обрезается до `MAX_DIFF_CHARS = 6000` (head 70% + tail 20%).
- **UI** — `AiSettingsDialog` (preset `select` с Cloud/Local/Web optgroups + Custom), `AiGenerateButton` в commit bar, горячий путь через `useAiConfig`.

## Безопасность данных

### 5 уровней защиты

1. **Git reflog** — встроенный, 90 дней
2. **Auto-stash** — сохраняет незакоммиченные изменения перед деструктивными операциями
3. **Хеш HEAD** — сохраняется для отката
4. **WAL-журнал** — `.git/GitBor-journal.json`, begin/complete/fail
5. **RecoveryManager** — проверки при старте: lock-файлы (устаревший `.git/index.lock` игнорируется при старте), незавершённые операции, rebase, merge

### Безопасность входа

- **Защита от path traversal** — `safePath()` валидирует все IPC-пути через `realpathSync.native` (разрешает симлинки, case-insensitive на Windows), не даёт доступ за пределы репо
- **Гард опасных корней** — `isDangerousRepoRoot()` пропускает worktree-watcher для home / корня диска / `C:\Windows` / `Program Files` / `node_modules` (открыть такую папку можно; гасится только watcher, чтобы избежать каскада `EPERM`)
- **Валидация имён файлов** — `isSafeFilename()` проверяет имена SSH-ключей и git-хуков на спецсимволы
- **`AppError`** — структурированная ошибка с `code` + `data`; `MessageBridge` шлёт `error`-событие с кодом, renderer переводит через `locale.repoErrors[code]`
- **Санитизация логов** — `sanitizeArgs` редактит commit-сообщения и passphrase после `-m` / `-C` / `-N` / `--message`
- **Защита от shell injection** — `openInTerminal` использует `execFile`/`spawn`, никогда `exec`
- **Безопасный clipboard** — обёртка `copyToClipboard()` с обработкой ошибок
- **Electron sandbox** — `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- **Атомарная запись** — tmp+rename с fsync, Windows-retry через `Atomics.wait` (без busy-spin)

### Кросс-платформенность

- `.gitattributes` для согласованных переводов строк (LF для исходников, CRLF для .bat/.cmd)
- Кросс-платформенные пути через `path.join()` / `path.resolve()` по всему коду
- Терминал: fallback-цепочка для Linux (gnome-terminal, konsole, xfce4-terminal, xterm)
- Авто-выбор `NUL` / `/dev/null` по платформе

## Логирование

Двусторонняя система: и main, и renderer пишут логи только в dev-режиме; production-console молчит.

- **Main** — singleton `mainLogger` с уровнями `silent`/`error`/`warn`/`info`/`debug`. `configureMainLogger({ isProduction })` в `main.ts` ставит default по `app.isPackaged`. Переменная `GITBOR_LOG_LEVEL=debug` переопределяет без пересборки.
- **Renderer** — префикс `[GitBor]`; методы no-op в Vite production-сборке (`import.meta.env.DEV === false`).
- **`perf.ts`** — отдельный диагностический инструмент со своим opt-in (`GITBOR_PERF=1` / `window.__GITBOR_PERF__ = true`).

---

## Статус

Версия 0.1.0. Backend и UI feature-complete для MVP. ESLint + Prettier настроены; husky 9 + lint-staged 17 запускают `eslint --fix` и project-wide `tsc --noEmit` при каждом коммите; `npm test` запускается в `.husky/pre-push` (bypass через `SKIP_TESTS=1`). CI: `ci.yml` гоняет lint/typecheck/test/build на Ubuntu / Windows / macOS (Node 20) для push-событий; `pr.yml` гоняет то же плюс E2E на Windows / Node 22 для pull request'ов. 0 npm audit уязвимостей (root + renderer). В продакшене не тестировался.

## Лицензия

MIT
