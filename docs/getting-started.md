> English version: [docs/en/getting-started.md](en/getting-started.md)

# Начало работы (GitBor)

Руководство для разработчиков GitBor — настольного Git-клиента на Electron.

## Требования

- Node.js 22+ (на нём работают PR-гейт и сборка релизов; CI-матрица дополнительно проверяет Node 20)
- npm 10+
- `git` в `PATH`

## Быстрый старт

```bash
npm install
npm install --prefix src/renderer
npm run dev
```

`npm run dev` через `concurrently`:

1. Запускает dev-сервер Vite на порту **5188** (renderer).
2. Собирает main process (`tsc -p tsconfig.main.json`) и запускает Electron, когда Vite готов.

В режиме разработки Electron грузит renderer с адреса Vite, main process — из `dist/main/`.

## Структура проекта

| Путь | Назначение |
|------|------------|
| `src/core/` | Main process: `git/` (GitExecutor, парсеры, менеджеры, `gitDir.ts`, `stashRef.ts`), `commands/`, `bridge/` (MessageBridge + `ipc/handlers*.ts`), `safety/`, `state/` (StateManager, RepoSlicesStore, RepoStateRefresher, RepoEventBus, FileWatcher), `services/` (RepoServicesRegistry), `workers/`, `activity/`, `ai/`, `ssh/`, `errors/`, `repoSummary/`, `utils/` |
| `src/main/` | Точка входа Electron: `main.ts`, автообновление (`AppUpdater.ts`, `updateFlavor.ts`, `releaseNotes.ts`), `gracefulShutdown.ts`, `cspOrigins.ts` |
| `src/preload/` | `contextBridge` — `index.ts` |
| `src/renderer/src/` | React UI: `App.tsx`, `AppDialogs.tsx`, `api.ts`, `features/` (по папке на фичу: graph, sidebar, changes, diff, merge, stash, checkout, rebase, reflog, bisect, blame, file-history, repo-manager, repo-tabs, toolbar, titlebar, layout, settings, ssh, ai, safety, statistics, worktrees, lfs, hooks, gitignore, git-activity, support, app-shell), `hooks/`, `ui/`, `i18n/`, `styles/`, `types/` |
| `tests/` | Vitest: юнит-тесты и интеграционные тесты на реальном git (по папке на слой) |
| `tests-e2e/` | Playwright E2E (Windows) |
| `docs/` | Документация (английская — в `docs/en/`) |
| `build/` | Ресурсы сборки: иконки, NSIS-скрипт, `release-notes.md` |
| `scripts/` | Иконки, флаги сборки, `update-test-counts.mjs` |

## Рабочий процесс

- **Main process.** После правок пересоберите `npx tsc -p tsconfig.main.json` и перезапустите Electron — Vite HMR main не перезагружает.
- **Renderer.** Правки в `src/renderer/` подхватываются Vite HMR без перезапуска.
- **Проверки перед коммитом.** Хук pre-commit запускает `eslint --fix` и `tsc --noEmit` для main и renderer, pre-push — `npm test` (пропустить: `SKIP_TESTS=1`).

## Как добавить новую команду (IPC от начала до конца)

1. **Типы** — расширьте типы в `src/core/git/types/`. Renderer получает их через реэкспорт в `src/renderer/src/types/index.ts`, отдельно дублировать не нужно.
2. **Контракт IPC** — добавьте вариант в `RendererCommand` (и, если ответ идёт событием, в `MainEvent`) в `src/core/bridge/messages.ts`.
3. **Логика git** — функция в `src/core/commands/readCommands.ts` (чтение) или `writeCommands.ts` (запись) через `queue.enqueueRead()` / `enqueueWrite()`.
4. **CommandHandler** — метод в `src/core/commands/CommandHandler.ts`, который её вызывает.
5. **Хендлер** — запись в подходящей таблице `src/core/bridge/ipc/handlers*.ts` (`State`, `GitOps`, `RepoExtras`, `Safety`, `Shell`, `Ai`, `AppUpdate`). Для операций используйте `op` / `opWithPostMerge` из `helpers.ts`: они фиксируют `repoPath` до старта, и переключение вкладки во время операции ничего не ломает. Если ответ нужен как результат вызова (без события), просто верните значение из хендлера.
6. **Renderer** — `postCommand()` (событие в ответ) или `invokeCommand()` (результат вызова) из `src/renderer/src/api.ts`; ответы-события слушайте через `onMainEvent()`.
7. **Только чтение?** Добавьте тип команды в `NON_RETRYABLE_TYPES` в `api.ts`, чтобы кнопка «Повторить» в тосте не перезапускала её вместо настоящей операции.

### Как добавить AI-провайдера

1. Реализуйте `AiProvider` (`src/core/ai/providers/base.ts`): `testConnection` и `complete(options)` со стримом через `onChunk`.
2. Добавьте режим в `AiConnectionMode` (`src/core/ai/types.ts`) и ветку в `AiService.ensureProvider()`.
3. Добавьте пресет в `src/renderer/src/features/ai/presets.ts` и подписи в `en.ts` / `ru.ts`.
4. Секреты храните через `AiConfigStore` (шифрование `safeStorage`, запасной префикс `plain:`).

## Сборка

```bash
npm run build   # renderer + main
npm start       # запуск собранного приложения
```

Установщики, релизы на GitHub, автообновление и пути пользовательских данных — в [BUILD.md](BUILD.md).

## Устранение неполадок

| Проблема | Что сделать |
|----------|-------------|
| Порт 5188 занят | Завершите процесс на порту или задайте другой `VITE_DEV_PORT`. |
| Ошибки TypeScript в main | Проверьте `tsconfig.main.json` и пути; исправьте типы до запуска. |
| HMR не обновляет UI | Перезагрузите окно Electron (**Ctrl+R**). |
| Правки main не видны | Пересоберите `npx tsc -p tsconfig.main.json` и перезапустите Electron. |
| `npm ci` падает с ERESOLVE | В репозитории есть `.npmrc` с `legacy-peer-deps` — запускайте из корня проекта. |
