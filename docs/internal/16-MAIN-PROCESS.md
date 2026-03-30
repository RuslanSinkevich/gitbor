# 16 — main.ts (Electron Main Process)

## Слой: Integration
## Файл: `src/main/main.ts`
## Зависимости: все модули

---

## Назначение

Точка входа Electron-приложения. Создаёт экземпляры всех модулей, связывает их через конструкторы (DI без фреймворка), запускает RecoveryManager, создаёт окно.

Заменяет `extension.ts` из SkyFork.

## Структура main.ts

```typescript
import { app, BrowserWindow, dialog, shell, Menu } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let gitExecutor: GitExecutor | null = null;
let journal: OperationJournal | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'SkyFork',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Загрузить React-приложение
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5188'); // порт = VITE_DEV_PORT (см. npm run dev)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

async function initializeApp(repoPath: string): Promise<void> {
  // === Определить путь к git ===
  const gitPath = await resolveGitPath();

  // === ПРОВЕРКА 0: Git доступен? ===
  gitExecutor = new GitExecutor(repoPath, gitPath);
  const recovery = new RecoveryManager(gitExecutor, journal!, safetyNet);
  const gitCheck = await recovery.checkGitAvailable();

  if (!gitCheck.available) {
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'error',
      title: 'Git не найден',
      message: 'SkyFork: Git не обнаружен. Для работы приложения необходим Git.',
      buttons: ['Скачать Git', 'Указать путь', 'Закрыть'],
      defaultId: 0,
    });

    if (result.response === 0) {
      shell.openExternal('https://git-scm.com/downloads');
    } else if (result.response === 1) {
      const fileResult = await dialog.showOpenDialog(mainWindow!, {
        title: 'Укажите путь к git',
      });
      if (fileResult.filePaths.length > 0) {
        store.set('gitPath', fileResult.filePaths[0]);
      }
    }
    return;
  }

  // === Слой 1: Git Layer ===
  // gitExecutor уже создан

  // === Слой 2: Safety Layer ===
  journal = new OperationJournal(path.join(repoPath, '.git'));
  const safetyNet = new SafetyNet(gitExecutor, journal);
  const queue = new OperationQueue();
  const recoveryManager = new RecoveryManager(gitExecutor, journal, safetyNet);

  // === ПЕРВЫМ ДЕЛОМ: проверка на прерванные операции ===
  const report = await recoveryManager.checkOnStartup();
  if (report.hasIssues) {
    // Показать диалог восстановления
    for (const issue of report.issues) {
      // ... dialog.showMessageBox для каждой проблемы
    }
  }

  // === Слой 3: Application Layer ===
  const stateManager = new StateManager(gitExecutor, GitParser, computeGraphLayout);
  const fileWatcher = new FileWatcher(stateManager);
  const commandHandler = new CommandHandler(gitExecutor, queue, safetyNet, stateManager);
  const conflictManager = new ConflictManager(gitExecutor, stateManager);

  // === Слой 4: Bridge Layer ===
  const ipcBridge = new IpcBridge(commandHandler, stateManager, conflictManager);
  ipcBridge.registerHandlers();
  ipcBridge.setMainWindow(mainWindow!);

  // === Запуск ===
  fileWatcher.watch(repoPath);
  await stateManager.refreshAll();
}

app.whenReady().then(async () => {
  await createWindow();
  buildNativeMenu();

  // Если передан путь через аргументы командной строки
  const repoPath = process.argv[2] || null;
  if (repoPath) {
    await initializeApp(repoPath);
  }
  // Иначе — показать экран выбора репозитория
});
```

## Определение пути к git

```typescript
async function resolveGitPath(): Promise<string> {
  // 1. Bundled git
  const bundledPath = path.join(
    process.resourcesPath,
    'git',
    process.platform === 'win32' ? 'win32/cmd/git.exe' : 'linux/git'
  );
  if (fs.existsSync(bundledPath)) return bundledPath;

  // 2. Переменная окружения
  if (process.env.SkyFork_GIT_PATH) return process.env.SkyFork_GIT_PATH;

  // 3. Пользовательская настройка
  const userPath = store.get('gitPath');
  if (userPath && fs.existsSync(userPath)) return userPath;

  // 4. Системный git
  return 'git';
}
```

## Порядок инициализации

```
0. resolveGitPath()           — найти git
1. GitExecutor                (путь к git + cwd)
2. OperationJournal           (путь к .git)
3. SafetyNet                  (GitExecutor, Journal)
4. OperationQueue             (нет зависимостей)
5. RecoveryManager            (GitExecutor, Journal, SafetyNet)
6. --- RecoveryManager.checkOnStartup() ---
7. StateManager               (GitExecutor, GitParser, GraphLayout)
8. FileWatcher                (StateManager)
9. CommandHandler             (GitExecutor, Queue, SafetyNet, StateManager)
10. ConflictManager           (GitExecutor, StateManager)
11. IpcBridge                 (CommandHandler, StateManager, ConflictManager)
12. --- ipcBridge.registerHandlers() ---
13. --- stateManager.refreshAll() ---
14. --- fileWatcher.watch() ---
```

RecoveryManager запускается ДО StateManager — чтобы восстановить состояние прежде чем читать данные.

## Граф зависимостей

```
main.ts создаёт:
  GitExecutor
    └→ SafetyNet
    └→ StateManager
    └→ CommandHandler
    └→ ConflictManager

  OperationJournal
    └→ SafetyNet
    └→ RecoveryManager

  OperationQueue
    └→ CommandHandler

  StateManager
    └→ FileWatcher
    └→ IpcBridge
    └→ CommandHandler
    └→ ConflictManager

  CommandHandler
    └→ IpcBridge

  ConflictManager
    └→ IpcBridge
```

Нет циклических зависимостей.

## Lifecycle

```typescript
// Закрытие приложения
app.on('before-quit', async () => {
  try {
    if (journal) {
      const incomplete = await journal.getIncomplete();
      for (const entry of incomplete) {
        await journal.fail(entry.id, 'Application closed');
      }
    }
    gitExecutor?.killAll();
  } catch {
    // Игнорируем ошибки при закрытии
  }
});

// macOS: повторное открытие
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Все окна закрыты
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

## Нативное меню

Создаётся через `Menu.buildFromTemplate()` — описано в 01-ARCHITECTURE.md.

## Хранение настроек

`electron-store` для:
- Размеры панелей
- Последние открытые репозитории (Recent)
- Язык интерфейса
- Тема (light/dark/system)
- Путь к git (если переопределён)

Файл: `%APPDATA%/SkyFork/config.json` (Windows) / `~/.config/SkyFork/config.json` (Linux)

## Файловая структура

```
src/
  main/
    main.ts              — точка входа Electron
    IpcBridge.ts         — IPC мост
    menu.ts              — нативное меню
  preload/
    index.ts             — contextBridge
    types.ts             — типы для window.SkyForkAPI
  core/
    git/
      types.ts
      GitExecutor.ts
      GitParser.ts
      GraphLayout.ts
    safety/
      AtomicWrite.ts
      OperationJournal.ts
      SafetyNet.ts
      OperationQueue.ts
      RecoveryManager.ts
    state/
      StateManager.ts
      FileWatcher.ts
    commands/
      CommandHandler.ts
      ConflictManager.ts
    bridge/
      messages.ts
  renderer/              — React (Vite)
    index.html
    src/
      App.tsx
      components/
        sidebar/
        graph/
        changes/
        merge/
        detail/
        common/
      i18n/
      hooks/
      store/
```
