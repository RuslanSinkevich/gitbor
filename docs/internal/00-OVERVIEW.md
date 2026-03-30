# SkyFork — Обзор проекта

## Что это

SkyFork — standalone десктопный Git-клиент в стиле Fork.
Бесплатный, open source, кросс-платформенный (Windows + Linux).
Часть экосистемы Sky (Skycode IDE + SkyFork + методология).

## Зачем

1. **Импортозамещение.** Fork запрещён в России. GitKraken, SourceTree — проприетарные, недоступные. Российского desktop git GUI не существует.
2. **Ниша пустая.** GitVerse, GitFlic, EvaGit — это веб-платформы (аналоги GitHub/GitLab). Десктопного клиента нет.
3. **Часть платформы.** SkyFork — «мясо» для экосистемы Sky. IDE + Git-клиент + методология = полный стек разработчика.

## Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Платформа | Electron |
| Фронтенд | React 18, TypeScript, Vite |
| Бэкенд | TypeScript, Node.js (Electron main process) |
| Git | Bundled git binary (встроенный, пользователь ничего не ставит) |
| Diff/Merge | Monaco Editor (движок VS Code) |
| Граф | HTML Canvas 2D |
| Лицензия | MIT |

## Отличие от SkyFork (VS Code extension)

SkyFork — расширение для VS Code. SkyFork — самостоятельное приложение.

| | SkyFork | SkyFork |
|---|---------|--------|
| Тип | VS Code extension | Standalone Electron app |
| Layout | Ограничен VS Code (sidebar + editor) | Полный контроль: 4+ панели |
| Diff/Merge | Делегируем VS Code | Свой (Monaco Editor) |
| Git | Системный | Bundled (встроенный) |
| Зависимости | Нужен VS Code | Ничего не нужно |

## Переиспользование

Весь бэкенд из SkyFork копируется с минимальными изменениями:

- Git Layer: `types.ts`, `GitExecutor.ts`, `GitParser.ts`, `GraphLayout.ts`
- Safety Layer: `AtomicWrite.ts`, `OperationJournal.ts`, `SafetyNet.ts`, `OperationQueue.ts`, `RecoveryManager.ts`
- App Layer: `StateManager.ts`, `FileWatcher.ts`, `CommandHandler.ts`, `ConflictManager.ts`
- Protocol: `messages.ts` → адаптируется под Electron IPC

Изменения нужны только в файлах с прямыми вызовами `vscode.*` API (RecoveryManager, CommandHandler).

## Целевая аудитория

- Российские разработчики, потерявшие доступ к Fork/GitKraken
- Корпорации, переходящие на Linux (Astra Linux, Alt Linux, РЕД ОС)
- Разработчики, которым нужен визуальный Git без привязки к IDE
