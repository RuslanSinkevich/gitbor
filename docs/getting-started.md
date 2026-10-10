> English version: [docs/en/getting-started.md](en/getting-started.md)

# Начало работы (GitBor)

Руководство для разработчиков GitBor — настольного Git-клиента на Electron (в духе Fork или GitKraken).

## Требования

- Node.js 22+ (соответствует PR-гейту; CI matrix крутит на Node 20)
- npm 10+
- `git` в PATH

## Быстрый старт

```bash
cd gitbor
npm install
npm run dev
```

`npm run dev` через `concurrently`:

1. Запускает dev-сервер Vite на порту **5188** (renderer).
2. Запускает компилятор TypeScript (`tsc`) для main process и Electron.

Vite отдаёт React renderer. `tsc` собирает TypeScript main process в `dist/`. В режиме разработки Electron загружает renderer с URL Vite.

## Структура проекта

| Путь | Назначение |
|------|------------|
| `src/core/` | Backend main process: `git/`, `commands/`, `bridge/` (с подмодулями `ipc/`), `safety/`, `state/` (StateManager + RepoSlicesStore + RepoStateRefresher + RepoEventBus), `services/` (RepoServicesRegistry), `workers/` (parserWorker + WorkerPool), `activity/`, `ai/` (AiService + providers), `ssh/`, `utils/` (Logger, AppError, pathSecurity, repoPathGuard) |
| `src/main/` | Точка входа Electron: `main.ts`, `i18n/` |
| `src/preload/` | `contextBridge` — `index.ts` |
| `src/renderer/` | React UI: `App.tsx`, `AppDialogs.tsx`, `features/` (graph / sidebar / changes / diff / merge / blame / file-history / rebase / repo-manager / repo-tabs / toolbar / titlebar / layout / ssh / settings / ai / reflog / bisect / hooks / worktrees / lfs / gitignore), `hooks/` (useAppState фасад + useRepoSlices + useRunningOps + useStateSubscription + ...), `ui/`, `api.ts`, `types/`, `i18n/`, `styles/` |
| `tests/` | Тесты (Vitest): `git/`, `commands/`, `state/`, `services/`, `activity/`, `safety/`, `bridge/`, `ai/`, `changes/`, `utils/`, `i18n/` |
| `docs/` | Документация |
| `dist/` | Собранный вывод |

## Рабочий процесс разработки

- **Main process:** После изменений в коде main process пересоберите `npx tsc -p tsconfig.main.json` и перезапустите Electron. Vite HMR не перезагружает main process.
- **Renderer:** Правки в `src/renderer/` подхватываются Vite HMR без полного перезапуска.
- **Полный перезапуск:** Остановите всё, что слушает порт 5188, при необходимости пересоберите, затем снова `npm run dev`.

## Добавление новой возможности (пошагово)

Пример: новая команда по IPC от начала до конца.

1. **Types** — Добавьте или расширьте типы в `src/core/git/types/` и при необходимости отразите или используйте их в `src/renderer/src/types/`.
2. **IPC contract** — Добавьте варианты `RendererCommand` и `MainEvent` в `src/core/bridge/messages.ts` и согласуйте с `src/renderer/src/types/ipc.ts`.
3. **Git / domain logic** — Реализуйте в `src/core/commands/readCommands.ts` или `writeCommands.ts` (или в подходящем модуле команд). Берите сервисы per-call через `state.getActiveServices()` — никаких полей класса с привязкой к одному репо.
4. **Handler** — Добавьте метод в `src/core/commands/CommandHandler.ts`, который вызывает новую логику.
5. **Bridge** — Добавьте хендлер в один из файлов `src/core/bridge/ipc/handlers*.ts` (state, gitOps, repoExtras, ai). Используйте `op` / `opWithPostMerge` из `helpers.ts`, чтобы `repoPath` снимался ДО старта операции (переключение вкладки между событиями не должно ломать per-repo running-флаг).
6. **Renderer API** — Вызывайте из UI через `postCommand()` в `src/renderer/src/api.ts`.
7. **UI** — Подписывайтесь через `onMainEvent()` в React-компоненте (или хуке) для ответов и обновлений. Для per-repo операций маршрутизируйте событие по `repoPath`, чтобы оно попало в нужный slice.

### Добавление AI-провайдера

Если нужно подключить ещё один AI-бэкенд:

1. Реализуйте `AiProvider` (`src/core/ai/providers/base.ts`) — `testConnection` и `complete(options)` с SSE-стримом через `onChunk`.
2. Добавьте новый mode в `AiConnectionMode` в `src/core/ai/types.ts`.
3. Добавьте ветку в `AiService.ensureProvider()`, чтобы инстанцировать его.
4. Добавьте пресет в `src/renderer/src/features/ai/presets.ts` и label-ключ в обоих `en.ts` / `ru.ts`.
5. Подключите хранение секретов в `AiConfigStore` (шифровать через `safeStorage`, fallback на `plain:`).

## Сборка

```bash
npm run build   # Renderer + main
npm start       # Run the packaged output
```

Для дистрибутивных инсталляторов, пакетинга по платформам, путей
пользовательских данных (`<userData>` на Win/Mac/Linux) и настройки
авто-обновлений — см. [BUILD.md](BUILD.md).

## Устранение неполадок

| Проблема | Что сделать |
|----------|-------------|
| Port 5188 in use | Завершите процесс, занявший порт, или задайте другое значение `VITE_DEV_PORT`. |
| TypeScript errors in main | Проверьте `tsconfig.main.json` и пути; исправьте типы до опоры на `dist/`. |
| HMR not updating UI | Перезагрузите окно Electron (например **Ctrl+R**). |
| Main changes seem ignored | Пересоберите через `tsc` для main config и перезапустите Electron. |
