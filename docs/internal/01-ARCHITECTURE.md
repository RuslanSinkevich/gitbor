# SkyFork — Архитектура

## 4 слоя

```
┌──────────────────────────────────────────────────────────────────┐
│  Renderer Process (React)                                         │
│                                                                   │
│  ┌─ Sidebar ──┐ ┌─ Main Area ──────────┐ ┌─ Detail Panel ─────┐ │
│  │ BranchTree │ │ CommitGraph (Canvas)  │ │ CommitDetails      │ │
│  │ TagList    │ │ LocalChanges          │ │ DiffViewer (Monaco)│ │
│  │ StashList  │ │ CommitBar             │ │ ThreeWayMerge      │ │
│  │ RemoteList │ │                       │ │                    │ │
│  └────────────┘ └───────────────────────┘ └────────────────────┘ │
│          │                                                        │
│          │  ipcRenderer.invoke() / .on()                          │
├──────────┼────────────────────────────────────────────────────────┤
│  Preload │  contextBridge.exposeInMainWorld('SkyForkAPI', {...})   │
├──────────┼────────────────────────────────────────────────────────┤
│  Main Process (Node.js)                                           │
│                                                                   │
│  ┌─ IPC Handlers ────────────────────────────────────────┐       │
│  │  ipcMain.handle('command', ...) → CommandHandler       │       │
│  │  webContents.send('event', ...) ← StateManager         │       │
│  └────────────────────────────────────────────────────────┘       │
│                                                                   │
│  ┌─ Application Layer ────────────────────────────────────┐       │
│  │  CommandHandler    StateManager    FileWatcher           │       │
│  │  ConflictManager   (из SkyFork)                         │       │
│  └──────────────────────────┬──────────────────────────────┘       │
│                              │                                     │
│  ┌─ Safety Layer ────────────┴─────────────────────────────┐       │
│  │  OperationQueue   SafetyNet   OperationJournal (WAL)    │       │
│  │  AtomicWrite      RecoveryManager (из SkyFork)          │       │
│  └──────────────────────────┬──────────────────────────────┘       │
│                              │                                     │
│  ┌─ Git Layer ───────────────┴─────────────────────────────┐       │
│  │  GitExecutor      GitParser       GraphLayout            │       │
│  │  (из SkyFork + bundled git path)                        │       │
│  └──────────────────────────┬──────────────────────────────┘       │
│                              │                                     │
│                    child_process.execFile()                        │
│                              │                                     │
│  ┌─ Bundled Git ─────────────┴─────────────────────────────┐       │
│  │  resources/git/win32/git.exe                             │       │
│  │  resources/git/linux/git                                 │       │
│  └──────────────────────────────────────────────────────────┘       │
└───────────────────────────────────────────────────────────────────┘
```

## Процессы Electron

### Main Process (Node.js)

Единственный процесс с доступом к файловой системе и git.
Содержит весь бэкенд: Git Layer, Safety Layer, Application Layer.
Управляет окнами, нативным меню, lifecycle приложения.

### Preload Script

Мост безопасности между Main и Renderer.
Через `contextBridge.exposeInMainWorld` выставляет типизированный API:

```typescript
// preload/index.ts
contextBridge.exposeInMainWorld('SkyForkAPI', {
  invoke: (command: string, payload?: any) => ipcRenderer.invoke('SkyFork:command', command, payload),
  onEvent: (callback: (event: ExtensionEvent) => void) => {
    ipcRenderer.on('SkyFork:event', (_e, data) => callback(data));
  },
  offEvent: () => {
    ipcRenderer.removeAllListeners('SkyFork:event');
  },
});
```

### Renderer Process (React)

Изолированный процесс (sandboxed). Не имеет доступа к Node.js API.
Всё взаимодействие через `window.SkyForkAPI`.
React 18 + Vite для сборки.

## Коммуникация: IPC протокол

Переиспользуем типы из SkyFork `messages.ts`.

### Renderer → Main (команды)

```typescript
// Renderer вызывает:
const state = await window.SkyForkAPI.invoke('getState');
await window.SkyForkAPI.invoke('checkout', { branch: 'main' });
await window.SkyForkAPI.invoke('commit', { message: 'fix bug', amend: false });

// Main обрабатывает:
ipcMain.handle('SkyFork:command', async (event, command, payload) => {
  switch (command) {
    case 'getState': return commandHandler.getState();
    case 'checkout': return commandHandler.checkout(payload.branch);
    case 'commit': return commandHandler.commit(payload.message, payload.amend);
    // ... все команды из WebviewCommand
  }
});
```

### Main → Renderer (события)

```typescript
// Main отправляет:
mainWindow.webContents.send('SkyFork:event', {
  type: 'stateUpdate',
  data: partialState,
});

// Renderer слушает:
window.SkyForkAPI.onEvent((event) => {
  switch (event.type) {
    case 'fullState': setState(event.data); break;
    case 'stateUpdate': mergeState(event.data); break;
    case 'operationStart': setLoading(true); break;
    // ... все события из ExtensionEvent
  }
});
```

## Bundled Git

### Стратегия поиска git

```
1. Проверить resources/git/{platform}/git → если есть, использовать
2. Проверить переменную окружения SkyFork_GIT_PATH → если задана, использовать
3. Проверить системный git (which/where) → если есть, использовать
4. Показать ошибку: "Git не найден"
```

### Размеры

- MinGit для Windows: ~45MB (минимальный набор, без GUI и docs)
- Linux static git: ~20MB

### Обновление

Bundled git обновляется вместе с приложением. Версию выбираем стабильную (git 2.44+).

## Layout системы

### Flex-based resizable layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Menu Bar (нативное Electron Menu)                               │
│  File | Edit | View | Repository | Branch | Help                 │
├─────┬──────────────────┬───────────────────────┬────────────────┤
│     │                  │                       │                │
│  S  │                  │                       │                │
│  I  │   MAIN AREA      │                       │  DETAIL        │
│  D  │                  │                       │  PANEL         │
│  E  │   (переключаемый │                       │                │
│  B  │    контент)       │                       │  (diff,        │
│  A  │                  │                       │   details,     │
│  R  │                  │                       │   merge)       │
│     │                  │                       │                │
│     │                  │                       │                │
├─────┴──────────────────┴───────────────────────┴────────────────┤
│  Status Bar: branch | ahead/behind | operation status            │
└─────────────────────────────────────────────────────────────────┘
```

Разделители между панелями — drag-resizable.
Размеры сохраняются в `electron-store` между сессиями.

### Режимы Main Area

1. **Changes** — Unstaged / Staged файлы + Commit Bar
2. **Graph** — Canvas граф коммитов с цветными линиями
3. **Merge** — Список конфликтных файлов + прогресс

Переключение через табы или через действия (начал merge → автоматически переключился в Merge).

## Нативное меню

```
File
  ├─ Open Repository...       Ctrl+O
  ├─ Recent Repositories  ►
  ├─ Close Repository          Ctrl+W
  └─ Exit                      Alt+F4

Edit
  ├─ Undo                      Ctrl+Z
  ├─ Redo                      Ctrl+Shift+Z
  └─ Preferences...            Ctrl+,

View
  ├─ Changes                   Ctrl+1
  ├─ Graph                     Ctrl+2
  ├─ Toggle Sidebar            Ctrl+B
  └─ Toggle Detail Panel       Ctrl+D

Repository
  ├─ Fetch                     Ctrl+Shift+F
  ├─ Pull                      Ctrl+Shift+P
  ├─ Push                      Ctrl+Shift+U
  ├─ Stash...                  Ctrl+Shift+S
  └─ Stash Pop                 Ctrl+Shift+A

Branch
  ├─ New Branch...             Ctrl+Shift+N
  ├─ Merge...                  Ctrl+M
  └─ Delete Branch...

Help
  ├─ Documentation
  ├─ About SkyFork
  └─ Check for Updates
```

## Хранение настроек

`electron-store` для:
- Размеры панелей
- Последние открытые репозитории (Recent)
- Язык интерфейса
- Тема (light/dark/system)
- Путь к git (если переопределён пользователем)

Файл: `%APPDATA%/SkyFork/config.json` (Windows) / `~/.config/SkyFork/config.json` (Linux)
