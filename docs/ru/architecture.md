> English version: [docs/architecture.md](../architecture.md)

# Архитектура GitBor

## Обзор

GitBor — четырёхслойное приложение на Electron. Зависимости направлены только вниз.

## Слои

```
Renderer (React) → Preload (contextBridge) → Main (Node.js) → Git binary
```

- **Renderer** — React 18, Vite, CSS Modules. Папки фич: graph, sidebar, changes (с вынесенным `fileTreeModel.ts`), diff, merge, blame, file-history, rebase, repo-manager, repo-tabs, toolbar, titlebar, layout, ssh, settings, ai. Состояние ведёт `useAppState` (фасад над `useRepoSlices` + `useRunningOps` + `useStateSubscription`) плюс `useMenuActions`, `useKeyboardShortcuts`, `useOperationToasts`, `useDiffState`, `useTheme`, `useToasts`, `useContextMenu`, `useDialogs`, `useAutoFetch`.

- **Preload** — `contextBridge.exposeInMainWorld('gitBorAPI', …)` отдаёт в изолированный renderer `invoke`, `onEvent` и `platform`.

- **Main process** — Сервисы инициализируются в `main.ts`: `RepoServicesRegistry` (per-repo `GitExecutor` / `OperationQueue` / `SafetyNet`), `StateManager` (фасад над `RepoSlicesStore` + `RepoStateRefresher` + `RepoEventBus`), `CommandHandler`, `MessageBridge` (с разнесёнными хендлерами в `bridge/ipc/`), `FileWatcher`, `WorkerPool` для офлоада парсеров, `AiConfigStore` + `AiService` + `AiHandlers` для генерации commit message. IPC обрабатывается через `MessageBridge`. Нативное меню убрано — `Menu.setApplicationMenu(null)`. Все меню и шорткаты — в renderer.

- **Git** — Запускается дочерним процессом через `execFile('git', args)`. `GitExecutor` отвечает за выполнение, таймаут, передачу env и логирование. `cwd` фиксируется на конструкторе — на репо приходится свой `GitExecutor`, чтобы переключение активного репо не «таскало» один executor между путями.

## Поток данных

```
User clicks button in React
  → postCommand({ type: 'stageFile', file: 'src/app.ts' })
  → api.ts → window.gitBorAPI.invoke(command)
  → preload/index.ts → ipcRenderer.invoke('gitbor:command', command)
  → MessageBridge.handleCommand(command)
  → CommandHandler.stageFile('src/app.ts')
  → writeCommands.stageFile() → git.exec(['add', '--', 'src/app.ts'])
  → StateManager.refreshStatusAndNotify()
  → MessageBridge.send({ type: 'stateUpdate', data: newState })
  → preload → ipcRenderer.on('gitbor:event')
  → api.ts eventListeners → useAppState setState
  → React re-renders with new stagedFiles
```

## Модули core

Модули в `src/core/`:

| Модуль | Назначение |
|--------|------------|
| **GitExecutor** | Запуск Git через `execFile`, таймаут ~30 с, поддержка env, лог в файл. Чувствительные аргументы (сообщения, пароли) редактируются через `sanitizeArgs`. `cwd` задаётся на конструкторе — переключение между репо происходит на уровне `RepoServicesRegistry`, а не `setCwd`. `killAll()` шлёт SIGTERM активным процессам только своего репо. |
| **RepoServicesRegistry** | Реестр per-repo сервисов: `Map<repoPath, { git, queue, safety }>` + bootstrap-набор для clone/init без открытого репо. `acquire(repoPath)` создаёт сервисы лениво, `release(repoPath)` убивает inflight процессы. Это разрывает глобальную сериализацию: длинный `git pull` на репо A не блокирует операции на репо B. |
| **GitParser** | Чистые парсеры: `parseCommits`, `parseBranches`, `parseTags`, `parseStatus`, `parseFileChanges`. Большие выводы (статус > 256 KB, log > 512 KB) офлоадятся в `WorkerPool`. |
| **GraphLayout** | Распределение дорожек для раскладки графа коммитов. Вычисляется в worker thread при `commits.length > 2000`. |
| **WorkerPool** | Пул `worker_threads` (2 worker'а, round-robin) для CPU-тяжёлых задач: `parseStatus`, `parseCommits`, `computeGraphLayout`. Маленькие inputs обрабатываются inline (порог по размеру). При `error`/нештатном `exit` slot удаляется и через `setImmediate` спаунится новый — мёртвый worker никогда не остаётся в пуле. |
| **DiffParser** | Преобразует unified diff в `FileDiff` / `DiffHunk` / `DiffLine`. |
| **ConflictParser** | Разбор conflict markers для merge editor. |
| **GitConfig** | Чтение/запись `user.name`, `user.email` (local/global scope). |
| **StateManager** | Тонкий фасад. Публичная поверхность (`getState`, `getActiveServices`, `getGit`, `getRegistry`, `refresh*`, `switchRepo`, `setRepoPath`, `setOpenRepos`, `clearRepo`, `subscribe`, `onRepoSwitch`, `onRepoClose`, `notifyRepoClose`, `invalidateGraphCache`, `setOperationRunning`) сохранена 1:1, тело делегирует в три независимых класса (см. ниже). |
| **RepoSlicesStore** | `Map<repoPath, RepoSlice>` + общий `meta` (`openRepos`, `activeRepoIndex`) + mirror-функция, которая показывает активный slice как единый `AppState`. Вынесено из `StateManager`. |
| **RepoStateRefresher** | Все async `refresh*` методы (`refreshAll`, `refreshStatus`, `refreshCommits`, `refreshBranches`, ...). Каждый принимает `repoPath` и обновляет конкретный slice; перед работой проверяется `isRepoTracked(repoPath)`, чтобы фоновый refresh не «оживил» только что закрытый репо. Содержит `runSwitchRepoColdPhase` и `invalidateGraphCache`. |
| **RepoEventBus** | Три канала подписок: `state` (любое изменение), `switch` (сменился активный репо), `close` (репо удалили). Используется `MessageBridge`, `FileWatcher`, recovery-флоу. |
| **repoSlice** | `RepoSlice` тип + `emptyRepoSlice` / `mirrorRepoSliceToAppState` / git-format константы (`GIT_LOG_FORMAT`, `GIT_REF_FORMAT`, `GIT_TAG_REF_FORMAT`, `GIT_STASH_FORMAT`) + `hashGitStdout` для дедупа `git log`. |
| **CommandHandler** | Оркестрирует работу с Git; делегирует в `readCommands` / `writeCommands`. Все исполнители (`git`/`queue`/`safety` + `RebaseManager`/`ConflictManager`/...) берутся per-call через `state.getActiveServices()` — никаких mutable polей класса с привязкой к одному репо. На `openRepo` бросается `AppError('repoErrors.notARepo', { path })` с локализационным кодом, если путь не Git-репо. |
| **MessageBridge** | Electron IPC: тонкая обёртка ~150 строк. Принимает `RendererCommand`, ищет хендлер в `ipcCommandHandlers` (агрегат из `bridge/ipc/handlersState.ts`, `handlersGitOps.ts`, `handlersRepoExtras.ts`, `handlersAi.ts`). Ловит `AppError` и шлёт `error`-event с `code`+`data` для локализации в renderer. Шлёт `graphData` с дедупом по ссылкам (`sentGraphByRepo`) — повторное переключение A→B→A не гонит мегабайты JSON через IPC. |
| **bridge/ipc/** | Подмодули IPC-хендлеров: `helpers.ts` (`runTracked`/`op`/`opWithPostMerge`/`errOnFail`/`mergeStateAfter`), `ready.ts`, `handlersState.ts` (lifecycle, diff/blame/history), `handlersGitOps.ts` (push/pull/fetch/commit/stage/merge/rebase), `handlersRepoExtras.ts` (LFS, worktrees, hooks, stats, bisect, repo-tabs, settings, SSH), `handlersAi.ts`. `op`/`opWithPostMerge` снимают `repoPath` ДО старта операции и шлют его в `operationStart`/`operationEnd`, чтобы переключение вкладки между событиями не сломало per-repo running-флаг. |
| **OperationQueue** | Per-repo: read-операции параллельно, write — сериализованы. Отдельная очередь на каждое репо означает, что блокировка одного репо не блокирует другое. |
| **SafetyNet** | Per-repo. Авто-stash перед рискованными операциями; откат при сбое. |
| **FileWatcher** | Per-repo `chokidar` watcher'ы (`.git` + worktree, создаются лениво через `setImmediate` с pre-scan). Worktree-watcher НЕ запускается при `isDangerousRepoRoot(path)` (домашка, корень диска, `C:\Windows`...) или при > 1000 top-level entries — иначе `EPERM`/`EACCES`-каскад на `AppData`/`OneDrive` рушит main. Чёткий race-guard: если репо закрыли пока async pre-scan ещё идёт — новые watcher'ы не создаются (или сразу закрываются). `chokidar.on('error')` глушит EPERM, depth=3, debounce: 50мс `.git`, 200мс worktree. |
| **repoPathGuard** | `isDangerousRepoRoot(path)` — проверка «опасности» пути (drive root / home / Windows / `Program Files` / `node_modules` / т.п.). Используется в `FileWatcher` для отключения worktree-watcher. Сам факт открытия таких папок больше не блокируется — пользователь может намеренно посмотреть на любую директорию. |
| **AppError** | Структурированная ошибка с локализационным кодом (`code`) и параметрами шаблона (`data`) + technical fallback. `MessageBridge` превращает в `error`-event с `code`/`data`; renderer переводит через `locale.repoErrors[code]` и интерполирует. Альтернатива «строкам на английском, которые не переведены». |
| **gitActivityStore** | Журнал git-операций (start/append/finish) с `repoPath` per entry. `activityContext.ts` использует `AsyncLocalStorage`, чтобы `GitExecutor.exec` мог привязать выполненную команду к активной операции без явной передачи id. Renderer фильтрует журнал по `repoPath` активной вкладки; кэп = 100 entries; stdout/stderr обрезаются до `OUTPUT_CAP_BYTES = 16 KiB` с маркером `[truncated...]`. |
| **Logger** | Уровневое логирование (`silent`/`error`/`warn`/`info`/`debug`) с разделением stdout/stderr и опциональным `WriteStream` в `<userData>/logs/YYYY-MM-DD.log`. Singleton `mainLogger` — один источник уровня для всех модулей. `configureMainLogger({ isProduction })` настраивается из `main.ts` после `app.whenReady`: prod → `silent` (тишина и в console, и в файл), dev → `debug`. ENV `GITBOR_LOG_LEVEL` перебивает дефолт — для дебага у юзера в собранной версии. Все случайные `console.warn/error` в core (FileWatcher, WorkerPool, AiService и т. п.) переведены на `mainLogger`. Прямой `console.error` остался только в `process.on('unhandledRejection'/'uncaughtException')` — это последний рубеж, который должен сработать ДО `configureMainLogger`. |
| **SshKeyManager** | Список, генерация, удаление SSH-ключей в `~/.ssh/`. Двухшаговая генерация (пароль не в argv). |
| **ReflogParser** | Парсит вывод `git reflog` в структурированные записи. |
| **BisectManager** | Управляет сессиями `git bisect`: start, good, bad, skip, reset. |
| **HooksManager** | Список, вкл/выкл (toggle), чтение содержимого git hooks. |
| **WorktreeManager** | Список, добавление, удаление git worktrees. |
| **LfsManager** | Статус Git LFS, track/untrack паттернов, список управляемых файлов. |
| **pathSecurity** | Валидация путей: `safePath` (traversal + symlink через `realpathSync.native` + регистронезависимость на Windows), `isSafeFilename`. |
| **AtomicWrite** | Атомарная запись через tmp+rename с fsync. Retry на Windows через `Atomics.wait` (без busy-spin). |
| **AiService** | Фасад над `AiProvider`. `isConfigured()` проверяет активный режим (`openai-compatible` требует `baseUrl + model`; `qwen-web` требует `qwenWebToken + model`). `generateCommitMessage` строит промпты с учётом `commitLanguage`, зовёт провайдер и постпроцессит результат (срезает ```` ``` ```` и обрамляющие кавычки). |
| **AiHandlers** | Map из `requestId → AbortController`. `getConfig` маскирует секрет (`apiKey` / `qwenWebToken` → `••••••••`) перед отправкой в renderer. `setConfig` мёрджит секреты: маскированное или пустое значение от UI значит «оставь предыдущий секрет». `cancelAll()` отменяет все inflight генерации при выключении. |
| **AiConfigStore** | Хранилище конфига в `{userData}/ai-config.json` с `version: 2`. Atomic write через `atomicWriteJSON`. Секреты шифруются Electron `safeStorage` (DPAPI / Keychain / libsecret); если key store недоступен — fallback на префикс `plain:`, чтобы ключ оставался читаемым для диагностики. `clear()` пишет пустую запись, а не удаляет файл. |
| **OpenAiCompatibleProvider** | `/v1/chat/completions` с SSE-стримом. OpenAI, Ollama, LM Studio, DeepSeek, Groq. Возвращает `usage` и `finishReason` (`stop`/`length`/`error`/`aborted`). |
| **QwenWebProvider** | Неофициальный мост к `chat.qwen.ai`. Двушаговый флоу: `POST /api/v2/chats/new` для chat_id, потом `POST /api/v2/chat/completions?chat_id=…` с SSE. Сессионный токен из `localStorage` (без официального API-ключа DashScope). Для неизвестных id моделей фолбэк на `qwen3-max`. |

## Модули renderer

Папки возможностей в `src/renderer/src/features/`:

| Область | Содержимое |
|---------|------------|
| **graph/** | `CommitGraph` (virtualized), `CommitDetails`, `branchPaths`. |
| **sidebar/** | Sidebar: `BranchTree` (current branch — зелёная точка вместо текстового бейджа), tags, stashes, remotes, submodules. |
| **changes/** | `LocalChanges` (tree, контекстное меню по папкам применяет действия ко всем файлам внутри), `CommitBar` (subject + description), `FileTree` + вынесенные pure-helpers в `fileTreeModel.ts` (`buildFileTree`, `collectFiles`). |
| **diff/** | `DiffPanel`, `DiffView`, `DiffHunkView`, `DiffSideBySide` (каждый hunk = `.hunkBlock` с `HunkActionsOverlay` поверх блока при `:hover` / `:focus-within` — как в Fork; без постоянной шапки `@@` с кнопками; без префиксов `+`/`−` в тексте строк — только цвет), `HunkActionsOverlay` (общий компонент Stage / Discard / Unstage — одна точка правды для inline и split), `ImageDiff`. |
| **merge/** | `MergeDialog`, `MergeEditor`, `MergeBanner`, `ConflictPanel`. |
| — | **`AppDialogs.tsx`** — все модальные диалоги вынесены из `App.tsx` для разделения ответственности. |
| **blame/** | `BlameView`. |
| **file-history/** | `FileHistory`. |
| **rebase/** | `RebaseEditor`. |
| **repo-manager/** | `RepoManager`, недавние репозитории. |
| **repo-tabs/** | Вкладки для нескольких репозиториев. Вкладка «+» открывает `RepoManager`; повторный клик по активной вкладке — тоже открывает. Подсветка кнопки «+», когда менеджер активен. |
| **toolbar/** | Fetch, Pull, Push, Stash (открывает `SgPromptDialog` с `allowEmpty` — пустое значение = `git stash` без `-m`). |
| **titlebar/** | `TitleBar` с кастомным компонентом `MenuBar`. |
| **layout/** | `CommitsView`, `ChangesView`, `RightPanelContent`. |
| **ssh/** | `SshKeysDialog` — UI управления SSH-ключами. |
| **settings/** | `RepoSettingsDialog` — настройки user.name/email репозитория. |
| **ai/** | `AiSettingsDialog` (нативный `select` пресетов с optgroup Cloud/Local/Web + Custom; переключение между OpenAI-compatible и Qwen Web), `AiGenerateButton` (в `CommitBar`), хук `useAiConfig`, `presets.ts` с `detectPreset(mode, baseUrl, model)`, `errors.ts` для перевода `AiError.kind` в UI-сообщения. |
| **reflog/** | `ReflogDialog`, `ReflogTable`, `ReflogRow`, `ActionBadge`. |
| **bisect/** | `BisectDialog`, `BisectStartForm`, `BisectActiveSession`. |
| **hooks/** | `HooksDialog`, `HookItem`. |
| **worktrees/** | `WorktreesDialog`, `WorktreeItem`, `AddWorktreeForm`. |
| **lfs/** | `LfsDialog`, `LfsPatternList`, `LfsFileList`. |
| **gitignore/** | `GitignoreDialog`, шаблоны. |

Кастомные хуки в `src/renderer/src/hooks/`:

| Хук | Назначение |
|-----|------------|
| **useAppState** | Тонкий фасад. Композирует три хука ниже, держит transient state (`commitDetail`, `mergeState`, `error`, `viewOverride`, `rebase`, `recovery`, `pendingOpenDiff`/`MergeEditor`), собирает derived `AppState`, отдаёт `switchRepoFast` и `resetTransientState`. Публичная поверхность (форма return) не изменилась — `App.tsx` и потребители ничего не замечают. |
| **useRepoSlices** | `slices: Map<repoPath, RepoSlice>` + `meta` (`openRepos`, `activeRepoIndex`) + helpers (`replaceSlice`, `updateSlice`, `removeSlice`, `applyMetaPatch`). Переключение вкладки — это просто `setActiveRepoIndex(i)`, UI ререндерит срез нового репо (или `EMPTY_SLICE`, если ещё нет данных). |
| **useRunningOps** | Per-repo `runningOpsByRepo: Map<repoPath, operation>`. Отдаёт `getCurrentOp(repoPath)`, чтобы `state.isOperationRunning` зависел только от активной вкладки. Держит `lastOpResult` для `useOperationToasts`. |
| **useStateSubscription** | Единственный `onMainEvent` listener и dispatcher: маршрутизирует `stateUpdate`, `graphData`, `repoSwitch`, `repoClose`, `commitDetail`, `mergeState`, `rebaseProgress`, `recoveryIssues`, `error`, `operationStart`/`operationEnd`, `openDiff`, `openMergeEditor` в нужные сеттеры. Создаётся один раз за сессию — без переподписок при смене props. |
| **useMenuActions** | Единый обработчик для действий кастомного меню (dispatch по строке). |
| **useKeyboardShortcuts** | Привязка клавиш (Ctrl+O, Ctrl+Shift+F, F5 и т.д.) к действиям меню. Пропускает в input/textarea/contentEditable. |
| **useOperationToasts** | Автоматические тосты по результатам git-операций. |
| **useDiffState** | Управление текущим diff target (file + hash). |
| **useTheme** | Переключение тёмной/светлой темы с сохранением в localStorage. |
| **useToasts** | Очередь тост-уведомлений с автоскрытием. |
| **useContextMenu** | Состояние контекстного меню (позиция + пункты). |
| **useDialogs** | Централизованное состояние видимости диалогов (about, ssh, reflog, bisect, hooks, worktrees, lfs, gitignore, ai). |
| **useAutoFetch** | Периодический фоновый `fetch` для активного репо (настраиваемый интервал). |
| **useAiConfig** | Загружает/сохраняет `AiProviderConfig`; отдаёт `testConnection` и `generateCommitMessage` со стримингом через `onChunk`. |

## AI-модуль

`src/core/ai/`. Модуль независим: провайдеры — за маленьким интерфейсом `AiProvider`, остальная часть приложения общается с `AiHandlers` через IPC.

- **Режимы** — `openai-compatible` (любой `/v1/chat/completions` endpoint: OpenAI, Ollama, LM Studio, DeepSeek, Groq) и `qwen-web` (chat.qwen.ai через сессионный токен).
- **`AiProviderConfig`** — `mode`, `baseUrl`, `apiKey`, `qwenWebToken?`, `model`, `commitLanguage` (`auto`/`en`/`ru`), `headers?`, `timeoutMs?`.
- **Промпты** (`prompts.ts`) — `buildCommitSystemPrompt(language)` добавляет правила под язык; `buildCommitUserPrompt(diff, language)` обрезает diff до `MAX_DIFF_CHARS = 6000` (head 70% + tail 20% с маркером `[diff truncated, N chars omitted]` посередине); user-промпт повторяет language-инструкцию, потому что мелкие/квантизованные локальные модели часто «забывают» system prompt.
- **`AiService.generateCommitMessage`** — зовёт провайдер, потом `postProcessCommit` срезает ```` ``` ```` и обрамляющие кавычки (модели любят оборачивать ответ, даже когда просишь plain text).
- **Streaming** — оба провайдера стримят через SSE (`onChunk(delta)`). Renderer выводит чанки live в поле subject коммита.
- **Cancellation** — `AiHandlers` держит `Map<requestId, AbortController>`. UI зовёт `aiCancel(requestId)` при клике Stop или закрытии диалога.
- **Persistence** — `AiConfigStore` пишет `{userData}/ai-config.json` атомарно (`atomicWriteJSON`). Секреты шифруются Electron `safeStorage` с префиксом `enc:`; если системное key store недоступно — fallback на `plain:` с предупреждением в лог.
- **Маскирование секретов** — `AiHandlers.getConfig` возвращает конфиг с `apiKey`/`qwenWebToken`, заменёнными на `••••••••`, чтобы renderer никогда не видел настоящее значение. `setConfig` использует `mergeSecrets`: маскированное или пустое значение из UI трактуется как «оставь предыдущий секрет».
- **IPC-команды** — `aiGetConfig`, `aiSetConfig`, `aiTestConnection`, `aiGenerateCommitMessage`, `aiCancel`. События: `aiConfig`, `aiTestResult`, `aiChunk`, `aiResult`, `aiError`. Хендлеры в `bridge/ipc/handlersAi.ts`.

## Протокол IPC

`RendererCommand` задаёт 45+ типов команд; `MainEvent` — 30+ типов событий. Канонические определения в `src/core/bridge/messages.ts`. Renderer импортирует типы из `src/renderer/src/types/index.ts`, который реэкспортирует из `@core/git/types` и `@core/bridge/messages`.

## Управление состоянием

**В main** `StateManager` — тонкий фасад. Композирует:

- `RepoSlicesStore` — per-repo срезы (`slicesByRepo`) + общий `meta` (`openRepos`, `activeRepoIndex`).
- `RepoStateRefresher` — все async `refresh*`. `RepoStateRefresher.runSwitchRepoColdPhase(repoPath)` — это тяжёлая работа после смены вкладки (полный status + log + branches + tags); дешёвый `mirror+notify` срабатывает мгновенно в `switchRepo`.
- `RepoEventBus` — три канала: `state` (любое изменение), `switch` (сменился активный репо), `close` (репо удалили).

При каждом значимом изменении активного репо в renderer уходит `stateUpdate` (без `commits`/`graphLayout` — они отдельно через `graphData` с `repoPath` и дедупом по ссылкам в `MessageBridge.sentGraphByRepo`). Срезы НЕ-активных репо обновляются молча — когда юзер вернётся на вкладку, `switchRepo` мгновенно отзеркалит свежий slice.

**В renderer** `useAppState` — тоже тонкий фасад. Композирует:

- `useRepoSlices` — `slices: Map<repoPath, RepoSlice>` плюс глобальный `meta`.
- `useRunningOps` — `runningOpsByRepo: Map<repoPath, operation>`. `state.isOperationRunning` и `state.currentOperation` берутся ИСКЛЮЧИТЕЛЬНО от активной вкладки. Это решает «переключился на B пока fetch идёт на A — кнопки на B не должны быть disabled».
- `useStateSubscription` — единственный `onMainEvent` listener / dispatcher, создаётся один раз за сессию.

При смене вкладки UI мгновенно показывает срез нового репо (или пусто, если ещё не наполнено) — никаких полей чужого репо в state быть не может. Дополнительно:

- `translateError(code, data, fallback)` — переводит `error`-events с локализационным кодом (`repoErrors.notARepo`, ...) через `t()` + `tpl()`. Если кода нет в локали — fallback на `message` от main.
- `GitActivityIndicator` / `GitActivityDialog` принимают `repoPath` как props и фильтруют snapshot по нему: на вкладке репо A не видно операций B, и наоборот.

## Сохранение сессии

Открытые табы переживают перезапуск. Состояние хранится в renderer'ском `localStorage` (`sg-open-repos` — массив путей, ограничение 50; `sg-last-active-repo` — строка). Хелперы в `features/repo-manager/recentRepos.ts`: `loadOpenRepos` / `saveOpenRepos` / `clearOpenRepos`.

- На каждое изменение `state.openRepos` `App.tsx` пишет актуальный список путей в `sg-open-repos`.
- На старте `App.tsx` читает `sg-open-repos` и переоткрывает каждый репо через `invokeCommand({type:'openRepo'})` (последовательно, ошибки тихо игнорим — следующий save перепишет список без отсутствующего пути). Активный таб восстанавливается отдельным эффектом по `sg-last-active-repo`, сравнение пути нечувствительно к регистру и нормализует слэши через `sameRepoPath`.
- `sg-last-active-repo` остаётся как single-tab fallback для юзеров с пустым `sg-open-repos` (старые сессии до этой фичи).

`autoOpenRepo()` в `main.ts` (probe `process.cwd()` на git-репо) теперь **только в dev** (`return` если `app.isPackaged`). Без этого guard'а упакованный билд из ярлыка Start Menu резолвил бы `cwd` в `%USERPROFILE%` (или «start in» ярлыка) и тихо открывал любой git-репо, оказавшийся там, маскируя реальную сохранённую сессию.

## Стартап

`app.whenReady` параллелит два самых тяжёлых шага старта:

- `createWindow()` — Electron GPU-init + аллокация `BrowserWindow`.
- `initServices()` — probe `git --version`, `RepoServicesRegistry`, `StateManager`, `MessageBridge`, `FileWatcher`, AI-сервисы.

Оба идут одновременно. `messageBridge.attach(mainWindow)` дёргается после resolve `createWindow`, но ДО `loadWindow()` — так `ipcMain.handle('gitbor:command')` уже зарегистрирован к моменту, когда React монтируется и шлёт первый `postCommand`. `autoOpenRepo()` не awaited — стартует в фоне и пушит события через уже подключённый bridge. На холодном старте Windows — экономия ~0.5–1.5 с.

## Логирование

Двухсторонняя система: main и renderer пишут логи только в dev-режиме. В production console молчит — пользователь не видит шума в DevTools, а собранный билд не сорит в системный stdout.

**Main** — `src/core/utils/Logger.ts`:

- Singleton `mainLogger` с уровнями `silent` < `error` < `warn` < `info` < `debug`. ERROR/WARN идут в `console.error` (stderr), DEBUG/INFO — в `console.log` (stdout).
- `configureMainLogger({ isProduction })` вызывается из `main.ts` после `app.whenReady`. По умолчанию: `app.isPackaged` → `silent`, dev → `debug`. ENV `GITBOR_LOG_LEVEL=warn|info|debug|...` перебивает дефолт — удобно для дебага у пользователя в собранной версии без пересборки.
- Файл-лог `<userData>/logs/YYYY-MM-DD.log` открывается только при не-silent уровне (в prod не пишется ничего).
- Все случайные `console.warn/error` в core (FileWatcher, WorkerPool, handlersState, AiService, OpenAiCompatibleProvider, GitExecutor) переведены на `mainLogger`. Прямой `console.error` остался **только** в `process.on('unhandledRejection'/'uncaughtException')` — это последний рубеж, который должен сработать до `configureMainLogger`, поэтому привязывать его к logger'у нельзя.

**Renderer** — `src/renderer/src/shared/logger.ts`:

- Префикс `[GitBor]`. Все методы (`debug`/`log`/`info`/`warn`/`error`) — no-op в production-сборке Vite (`import.meta.env.DEV === false`). В dev — обычные `console.*`.
- Используется в `api.ts` (IPC error/warn) и `ErrorBoundary.tsx` (UI краш). Реальные UI-ошибки идут через ErrorBoundary + IPC `error`-канал в main, где попадают в `mainLogger.error`.

**`perf.ts`** (main и renderer) — отдельный диагностический инструмент с собственным opt-in (`GITBOR_PERF=1` / `window.__GITBOR_PERF__ = true`). Не путать с системой логов: perf включается вручную для замеров.
