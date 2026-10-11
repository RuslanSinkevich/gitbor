> English version: [docs/en/contributing.md](en/contributing.md)

# Участие в разработке GitBor

GitBor — настольный Git-клиент на Electron. Ошибки и предложения — в [GitHub Issues](https://github.com/RuslanSinkevich/gitbor/issues).

### Как добавить новую Git-команду

1. **Типы и контракт** — вариант в `RendererCommand` (и `MainEvent`, если ответ идёт событием) в `src/core/bridge/messages.ts`. Renderer получает типы через реэкспорт в `src/renderer/src/types/index.ts`.
2. **Логика git** — функция в `src/core/commands/readCommands.ts` (чтение) или `writeCommands.ts` (запись) через `queue.enqueueRead()` / `enqueueWrite()`. Сервисы (`git` / `queue` / `safety`) — свои у каждого репо, не кэшируйте их в полях класса.
3. **CommandHandler** — метод в `src/core/commands/CommandHandler.ts`.
4. **IPC-хендлер** — запись в одной из таблиц `src/core/bridge/ipc/handlers*.ts`. Для операций — `op` / `opWithPostMerge` из `helpers.ts`, чтобы `repoPath` фиксировался до старта.
5. **Renderer** — `postCommand()` или `invokeCommand()` из `src/renderer/src/api.ts`; события — через `onMainEvent()`, с маршрутизацией по `repoPath`.

Подробнее с примерами — [Начало работы](getting-started.md).

### Как добавить новую возможность в UI

1. Каталог `src/renderer/src/features/<фича>/`.
2. Компонент `.tsx` и при необходимости CSS Module.
3. `index.ts` с экспортами.
4. Подключение в `App.tsx` (диалоги — в `AppDialogs.tsx` через `useDialogs`).
5. Тексты — в `src/renderer/src/i18n/ru.ts` и `en.ts` (полноту проверяет `tests/i18n/i18n.test.ts`).

### Стиль кода

- TypeScript в strict mode.
- CSS Modules и переменные `--sg-*` для тем.
- Комментарии — только для неочевидного «почему», без пересказа кода.
- Имена файлов: PascalCase для компонентов (`CommitGraph.tsx`), camelCase для утилит (`branchPaths.ts`).

### Соглашения проекта

- **Состояние** — глобальное в `StateManager` (main, по репо через `RepoSlicesStore`); только UI — в `useState`. `state.isOperationRunning` берётся от активной вкладки.
- **Ошибки** — переводимые бросайте как `AppError(code, data, fallback)`; renderer переведёт через `locale.repoErrors[code]`. Ошибки git классифицирует `GitErrorClassifier` по английскому stderr — `GitExecutor` всегда запускает git с `LC_MESSAGES=C`.
- **Логи** — `mainLogger` из `src/core/utils/Logger.ts`, без сырых `console.*` в core.
- **Пути** — пользовательские пути через `safePath()`, имена файлов через `isSafeFilename()`; каталог `.git` — только через `resolveGitDir()` / `resolveCommonGitDir()` (`src/core/git/gitDir.ts`): в worktree и подмодулях `.git` — файл, а не папка.
- **`exec` не бросает на ненулевой код** — проверяйте `exitCode` сами, иначе сбой git выглядит как успех.
- **Чувствительные аргументы** — через `env` или stdin; если попали в argv, их должен скрывать `sanitizeArgs`.
- **Буфер обмена** — `copyToClipboard()` из `api.ts`.
- **Таймеры** — чистите в cleanup `useEffect`.
- **AI-секреты** — не логируйте; храните через `AiConfigStore`, в UI отдавайте замаскированными.

### Ветки и коммиты

- Ветки: `feat/…`, `fix/…`, `refactor/…`, `docs/…`.
- Коммиты — в формате conventional commits с областью, описание по-русски: `feat(graph): лаконичное меню коммита`, `fix(watcher): …`, `docs: …`, `chore(release): 0.1.23`. В теле — что и почему, если это не очевидно из заголовка.

### Чек-лист PR

- [ ] `npx tsc -p tsconfig.main.json` и `npx tsc --noEmit` в `src/renderer` без ошибок
- [ ] `npm run lint` проходит
- [ ] `npm test` проходит (сейчас <!-- TESTS_COUNT -->1116<!-- /TESTS_COUNT --> тестов в <!-- TESTS_FILES -->95<!-- /TESTS_FILES --> файлах; после добавления тестов — `npm run docs:counts`)
- [ ] `npm run e2e` проходит на Windows
- [ ] Новые тексты есть в `ru.ts` и `en.ts`
- [ ] Пользовательские пути проходят через `safePath()` / `isSafeFilename()`
- [ ] Проверено вручную в Electron, а не только в тестах
- [ ] `pr.yml` зелёный (lint / tsc / test / build / e2e на Windows)
