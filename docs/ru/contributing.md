> English version: [docs/contributing.md](../contributing.md)

# Участие в разработке SkyFork

SkyFork — настольный Git-клиент на Electron.

### Как добавить новую Git-команду

Пять шагов от идеи до работающей команды:

1. **Типы** — Добавьте тип команды в `RendererCommand` в `src/core/bridge/messages.ts`. Добавьте тип события ответа в `MainEvent`. Отразите оба в `src/renderer/src/types/ipc.ts`.

2. **Логика Git** — Добавьте функцию в `src/core/commands/readCommands.ts` (read) или `writeCommands.ts` (write). Используйте `queue.enqueueRead()` или `queue.enqueueWrite()`. Берите сервисы per-call через `state.getActiveServices()` — реестр per-repo, никогда не кэшируйте `git`/`queue`/`safety` в полях класса.

3. **CommandHandler** — Добавьте метод в `src/core/commands/CommandHandler.ts`, который вызывает функцию из шага 2.

4. **IPC-хендлер** — Добавьте запись в одну из таблиц `src/core/bridge/ipc/handlers*.ts` (`handlersState.ts`, `handlersGitOps.ts`, `handlersRepoExtras.ts`, `handlersAi.ts`). Используйте `op` / `opWithPostMerge` из `helpers.ts`, чтобы `repoPath` снимался **до** старта операции — переключение вкладки между `operationStart` и `operationEnd` не должно ломать per-repo running-флаг.

5. **Renderer** — Используйте `postCommand({ type: 'yourCommand', ... })` из `src/renderer/src/api.ts`. Слушайте ответ через `onMainEvent()` в React-компоненте или хуке. Маршрутизируйте по `repoPath`, если событие per-repo, чтобы оно попало в нужный slice.

### Как добавить новую возможность в UI

1. Создайте каталог `src/renderer/src/features/your-feature/`
2. Создайте компонент `.tsx` и CSS Module `.module.css`
3. Создайте `index.ts` с экспортами
4. Подключите в `src/renderer/src/App.tsx` (для диалогов — в `src/renderer/src/AppDialogs.tsx`)
5. Если нужен IPC — следуйте шагам из раздела «Как добавить новую Git-команду»

### Стиль кода

- TypeScript в strict mode
- CSS Modules с кастомными свойствами `--sg-*` для темизации
- Без комментариев к очевидному коду — комментарии только для неочевидного замысла
- Имена файлов: PascalCase для компонентов (`CommitGraph.tsx`), camelCase для утилит (`branchPaths.ts`)
- Один компонент в файле

### Соглашения проекта

- **Imports**: сначала React hooks, затем локальные модули, типы, стили
- **IPC types**: всегда синхронизируйте `src/core/bridge/messages.ts` и `src/renderer/src/types/ipc.ts`
- **State**: глобальное состояние в `StateManager` (main, per-repo через `RepoSlicesStore`); только UI — в React `useState`. Per-repo running ops — в `useRunningOps`; `state.isOperationRunning` берётся только от активной вкладки.
- **Error handling**: бросайте `AppError(code, data, fallback)` в main для переводимых ошибок — `MessageBridge` превратит в `error`-event с `code`/`data`, renderer переведёт через `locale.repoErrors[code]`. Обычный `throw new Error('...')` — только для технических ошибок без i18n.
- **Логирование**: используйте `mainLogger` из `src/core/utils/Logger.ts` — никаких сырых `console.warn/error` в core (единственное исключение — `process.on('unhandledRejection'/'uncaughtException')`, который должен сработать ДО `configureMainLogger`).
- **Безопасность путей**: все пользовательские пути через IPC валидируйте через `safePath()` из `src/core/utils/pathSecurity.ts`; имена файлов — через `isSafeFilename()`. Перед запуском рекурсивного watcher'а проверяйте `isDangerousRepoRoot()`.
- **Чувствительные аргументы**: передавайте через `env` или stdin когда возможно; если попадают в argv — убедитесь, что `sanitizeArgs` редактирует их в логах.
- **Clipboard**: используйте `copyToClipboard()` из `src/renderer/src/api.ts` вместо прямого `navigator.clipboard.writeText`
- **Таймеры**: `setTimeout` в React-компонентах всегда чистите через `clearTimeout` в `useEffect` cleanup или `useRef`
- **Диалоги**: новые диалоги добавляйте через хук `useDialogs` (`src/renderer/src/hooks/useDialogs.ts`) и рендерите из `AppDialogs.tsx`
- **AI-секреты**: никогда не логируйте API-ключи / Qwen-токены. Сохраняйте через `AiConfigStore` (шифруется `safeStorage`); маскируйте в любом payload, уходящем в UI (`••••••••`).

### Именование веток

- `feat/description` — новые возможности
- `fix/description` — исправления
- `refactor/description` — реструктуризация кода
- `docs/description` — документация

### Сообщения коммитов

- Короткий повелительный залог: «add merge editor», «fix diff for untracked files»
- Без префиксов вроде «feat:», если команда не договорилась о conventional commits

### Чеклист PR

- [ ] TypeScript собирается без ошибок (`npx tsc -p tsconfig.main.json`)
- [ ] ESLint проходит (`npm run lint`)
- [ ] Форматирование корректно (`npm run format`)
- [ ] Типы IPC синхронизированы между core и renderer
- [ ] Новые возможности имеют соответствующие IPC-команды от начала до конца
- [ ] Тесты проходят (`npm test`)
- [ ] Пользовательские пути валидируются через `safePath()` / `isSafeFilename()`
- [ ] Новые ключи i18n добавлены в оба языка (en + ru)
- [ ] Проверено вручную в Electron (не только в браузере)
- [ ] CI проходит (GitHub Actions: lint, typecheck, test, build на 3 ОС)
