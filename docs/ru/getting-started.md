> English version: [docs/getting-started.md](../getting-started.md)

# Начало работы (SkyFork)

Руководство для разработчиков SkyFork — настольного Git-клиента на Electron (в духе Fork или GitKraken).

## Требования

- Node.js 18+
- npm
- `git` в PATH

## Быстрый старт

```bash
cd skyfork
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
| `src/core/` | Backend main process: `git/`, `commands/`, `bridge/`, `safety/`, `state/`, `ssh/`, `utils/` |
| `src/main/` | Точка входа Electron: `main.ts`, `menu.ts`, `i18n/` |
| `src/preload/` | `contextBridge` — `index.ts` |
| `src/renderer/` | React UI: `features/`, `hooks/`, `ui/`, `api.ts`, `types/`, `i18n/`, `styles/` |
| `tests/` | Тесты (Vitest): `git/`, `safety/`, `bridge/`, `i18n/` |
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
3. **Git / domain logic** — Реализуйте в `src/core/commands/readCommands.ts` или `writeCommands.ts` (или в подходящем модуле команд).
4. **Handler** — Добавьте метод в `src/core/commands/CommandHandler.ts`, который вызывает новую логику.
5. **Bridge** — Маршрутизируйте команду и события в `src/core/bridge/MessageBridge.ts`.
6. **Renderer API** — Вызывайте из UI через `postCommand()` в `src/renderer/src/api.ts`.
7. **UI** — Подписывайтесь через `onMainEvent()` в React-компоненте (или хуке) для ответов и обновлений.

## Сборка

```bash
npm run build   # Renderer + main
npm start       # Run the packaged output
```

## Устранение неполадок

| Проблема | Что сделать |
|----------|-------------|
| Port 5188 in use | Завершите процесс, занявший порт, или задайте другое значение `VITE_DEV_PORT`. |
| TypeScript errors in main | Проверьте `tsconfig.main.json` и пути; исправьте типы до опоры на `dist/`. |
| HMR not updating UI | Перезагрузите окно Electron (например **Ctrl+R**). |
| Main changes seem ignored | Пересоберите через `tsc` для main config и перезапустите Electron. |
