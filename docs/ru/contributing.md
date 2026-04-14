> English version: [docs/contributing.md](../contributing.md)

# Участие в разработке SkyFork

SkyFork — настольный Git-клиент на Electron.

### Как добавить новую Git-команду

Пять шагов от идеи до работающей команды:

1. **Типы** — Добавьте тип команды в `RendererCommand` в `src/core/bridge/messages.ts`. Добавьте тип события ответа в `MainEvent`. Отразите оба в `src/renderer/src/types/ipc.ts`.

2. **Логика Git** — Добавьте функцию в `src/core/commands/readCommands.ts` (read) или `writeCommands.ts` (write). Используйте `queue.enqueueRead()` или `queue.enqueueWrite()`.

3. **CommandHandler** — Добавьте метод в `src/core/commands/CommandHandler.ts`, который вызывает функцию из шага 2.

4. **MessageBridge** — Добавьте `case` в `switch` `handleCommand()` в `src/core/bridge/MessageBridge.ts`. Вызовите метод CommandHandler, отправьте ответ через `this.send()`.

5. **Renderer** — Используйте `postCommand({ type: 'yourCommand', ... })` из `src/renderer/src/api.ts`. Слушайте ответ через `onMainEvent()` в React-компоненте.

### Как добавить новую возможность в UI

1. Создайте каталог `src/renderer/src/features/your-feature/`
2. Создайте компонент `.tsx` и CSS Module `.module.css`
3. Создайте `index.ts` с экспортами
4. Подключите в `src/renderer/src/App.tsx`
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
- **State**: глобальное состояние в `StateManager` (main); только UI — в React `useState`
- **Error handling**: ошибки Git перехватываются в `MessageBridge.handleCommand()`, отправляются событием `{ type: 'error', message }`
- **Безопасность путей**: все пользовательские пути через IPC валидируйте через `safePath()` из `src/core/utils/pathSecurity.ts`; имена файлов — через `isSafeFilename()`
- **Clipboard**: используйте `copyToClipboard()` из `src/renderer/src/api.ts` вместо прямого `navigator.clipboard.writeText`
- **Таймеры**: `setTimeout` в React-компонентах всегда чистите через `clearTimeout` в `useEffect` cleanup или `useRef`
- **Диалоги**: новые диалоги добавляйте через хук `useDialogs` (`src/renderer/src/hooks/useDialogs.ts`)

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
- [ ] Нет ошибок линтера в изменённых файлах
- [ ] Типы IPC синхронизированы между core и renderer
- [ ] Новые возможности имеют соответствующие IPC-команды от начала до конца
- [ ] Тесты проходят (`npm test`)
- [ ] Пользовательские пути валидируются через `safePath()` / `isSafeFilename()`
- [ ] Новые ключи i18n добавлены в оба языка (en + ru)
- [ ] Проверено вручную в Electron (не только в браузере)
