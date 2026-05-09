import { app, BrowserWindow, Menu, dialog, safeStorage, shell } from 'electron';
import { existsSync } from 'fs';
import * as path from 'path';
import * as net from 'net';
import { GitExecutor } from '../core/git/GitExecutor';
import { RepoServicesRegistry } from '../core/services/RepoServicesRegistry';
import { StateManager } from '../core/state/StateManager';
import { FileWatcher } from '../core/state/FileWatcher';
import { OperationJournal } from '../core/safety/OperationJournal';
import { SafetyNet } from '../core/safety/SafetyNet';
import { CommandHandler } from '../core/commands/CommandHandler';
import { MessageBridge } from '../core/bridge/MessageBridge';
import { RecoveryManager } from '../core/safety/RecoveryManager';
import { checkGitAvailable, showGitNotFoundMessage, showRecoveryDialog } from '../core/safety/RecoveryUI';
import { AiService } from '../core/ai/AiService';
import { AiConfigStore } from '../core/ai/AiConfigStore';
import { AiHandlers } from '../core/ai/AiHandlers';
import { configureMainLogger, mainLogger } from '../core/utils/Logger';
import { setupGracefulShutdown } from './gracefulShutdown';

let mainWindow: BrowserWindow | null = null;
let messageBridge: MessageBridge | null = null;
let fileWatcher: FileWatcher | null = null;
let commandHandler: CommandHandler | null = null;
let stateManager: StateManager | null = null;
let repoRegistry: RepoServicesRegistry | null = null;

/**
 * Глобальный safety net: если что-то в main кинуло unhandledRejection или
 * uncaughtException (chokidar при EPERM/EACCES на системные папки, async
 * вне try/catch), мы НЕ роняем процесс. С `--unhandled-rejections=strict`
 * на новых нодах это иначе превращается в краш main + закрытие окна.
 *
 * Здесь намеренно прямой `console.error` (а не logger): это аварийный
 * вывод — если logger ещё не сконфигурирован (ошибка до `app.whenReady`),
 * мы хотим увидеть её хоть где-то.
 */
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[SkyFork] unhandledRejection:', msg);
});
process.on('uncaughtException', (err) => {
  console.error('[SkyFork] uncaughtException:', err instanceof Error ? err.stack ?? err.message : err);
});

function waitForDevTcp(port: number, host = '127.0.0.1', timeoutMs = 45000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = (): void => {
      if (Date.now() - started > timeoutMs) {
        reject(
          new Error(
            `Dev server не отвечает на ${host}:${port}. Запустите «npm run dev» целиком или освободите порт ${port} (strictPort в Vite).`
          )
        );
        return;
      }
      const socket = net.createConnection({ port, host });
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        setTimeout(tryConnect, 250);
      });
    };
    tryConnect();
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'SkyFork',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // Жёсткий security-минимум: sandbox + contextIsolation + webSecurity.
      // Все четыре флага явно прописаны (не полагаемся на дефолты Electron),
      // потому что обновление major-версии может изменить дефолт без warning.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Spellcheck не нужен в git-клиенте, отключаем — экономия RAM,
      // меньше fingerprinting через спорные словари.
      spellcheck: false,
      // Worker thread'ы в renderer'е тоже без node API.
      nodeIntegrationInWorker: false,
    },
  });

  // Лочим открытие новых окон через window.open(...) и target=_blank.
  // Renderer не должен уметь породить второй BrowserWindow; внешние ссылки
  // открываем системным браузером через shell.openExternal.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Запрещаем навигацию внутри renderer'а на любой URL, кроме стартового
  // (file://.../index.html или http://127.0.0.1:5188 в dev). Защита от
  // случайной/злонамеренной навигации через <a href> или history.pushState.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedPrefixes = ['file://', 'http://127.0.0.1:', 'http://localhost:'];
    if (!allowedPrefixes.some((p) => url.startsWith(p))) {
      event.preventDefault();
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url);
      }
    }
  });

  // Блокируем любые попытки прицепить <webview> — в нашем UI их нет.
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    fileWatcher?.dispose();
    repoRegistry?.disposeAll();
    mainWindow = null;
  });
}

function rendererIndexPath(): string {
  return path.join(__dirname, '../renderer/index.html');
}

/**
 * Упакованный билд — всегда file://.
 * Распакованный `electron .`: Vite только если явно SKYFORK_VITE=1 (npm run dev),
 * иначе — собранный UI из dist (npm start после build), без ожидания 5188.
 */
async function loadWindow(): Promise<void> {
  if (!mainWindow) return;
  const devPort = Number(process.env.VITE_DEV_PORT || '5188');
  const indexHtml = rendererIndexPath();

  if (app.isPackaged) {
    await mainWindow.loadFile(indexHtml);
    return;
  }

  if (process.env.SKYFORK_VITE === '1') {
    await waitForDevTcp(devPort);
    await mainWindow.loadURL(`http://127.0.0.1:${devPort}`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  if (!existsSync(indexHtml)) {
    throw new Error(
      `Нет собранного UI. Выполните «npm run build» или запустите «npm run dev» (Vite + Electron).`
    );
  }
  await mainWindow.loadFile(indexHtml);
}

async function initServices(): Promise<void> {
  // Бутстрапный GitExecutor — только для проверки наличия git в PATH.
  // Реальные операции на репо идут через per-repo services в registry.
  const probeGit = new GitExecutor(process.cwd());
  const gitCheck = await checkGitAvailable(probeGit);
  if (!gitCheck.available) {
    await showGitNotFoundMessage();
  }

  repoRegistry = new RepoServicesRegistry();
  stateManager = new StateManager(repoRegistry);
  commandHandler = new CommandHandler(stateManager);

  const aiStore = new AiConfigStore(app.getPath('userData'), {
    isEncryptionAvailable: () => {
      try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
    },
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (buf) => safeStorage.decryptString(buf),
  });
  const aiService = new AiService(aiStore.load());
  const aiHandlers = new AiHandlers(aiService, aiStore);

  messageBridge = new MessageBridge(commandHandler, stateManager, aiHandlers);

  fileWatcher = new FileWatcher(stateManager);

  stateManager.onRepoSwitch((repoPath) => {
    fileWatcher?.switchRepo(repoPath);
  });

  stateManager.onRepoClose((closedPath) => {
    fileWatcher?.removeRepo(closedPath);
    messageBridge?.cleanupRepo(closedPath);
  });

  // Агрегированный глобальный флаг «идёт операция» больше НЕ нужен:
  // renderer теперь держит per-repo карту runningOpsByRepo и сам считает
  // флаг от активной вкладки. Глобальная подписка на onAnyOperationStatusChange
  // ломала UX (fetch на A блокировал кнопки на B).
}

async function autoOpenRepo(): Promise<void> {
  if (!stateManager || !commandHandler || !fileWatcher) return;

  // Бутстрапный GitExecutor с cwd = process.cwd() для определения,
  // есть ли git-репо рядом со стартовым каталогом (dev-кейс).
  const probeGit = new GitExecutor(process.cwd());
  let repoRoot: string | null = null;
  try {
    const checkGit = await probeGit.exec(['rev-parse', '--show-toplevel']);
    if (checkGit.exitCode === 0) {
      repoRoot = checkGit.stdout.trim().replace(/\//g, path.sep);
    }
  } catch {
    // not a git repo — stay on welcome screen
  }


  if (repoRoot) {
    stateManager.setRepoPath(repoRoot);
    await stateManager.switchRepo(repoRoot);
    fileWatcher.switchRepo(repoRoot);
  }

  if (repoRoot) {
    try {
      const services = stateManager.getRegistry().acquire(repoRoot);
      const gitDir = path.join(repoRoot, '.git');
      const journal = new OperationJournal(gitDir);
      const safety = new SafetyNet(services.git);
      const recovery = new RecoveryManager(services.git, journal, safety);
      const report = await recovery.checkOnStartup();
      if (report.hasIssues) {
        await showRecoveryDialog(report, recovery);
      }
    } catch {
      // recovery check failed — non-fatal
    }
  }
}

app.whenReady().then(async () => {
  // Настраиваем логирование ДО initServices: prod = silent, dev = debug
  // (или явный SKYFORK_LOG_LEVEL). Это нужно сделать после whenReady,
  // потому что file-лог читает `app.getPath('userData')`.
  configureMainLogger({ isProduction: app.isPackaged });
  mainLogger.debug(`startup: pid=${process.pid} platform=${process.platform} packaged=${app.isPackaged}`);

  await initServices();

  Menu.setApplicationMenu(null);

  try {
    await createWindow();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    dialog.showErrorBox('SkyFork', msg);
    app.quit();
    return;
  }

  if (messageBridge && mainWindow) {
    messageBridge.attach(mainWindow);
  }

  try {
    await loadWindow();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    dialog.showErrorBox('SkyFork', msg);
    app.quit();
    return;
  }

  await autoOpenRepo();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void (async () => {
        try {
          await createWindow();
          if (messageBridge && mainWindow) {
            messageBridge.attach(mainWindow);
          }
          await loadWindow();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          dialog.showErrorBox('SkyFork', msg);
        }
      })();
    }
  });
});

setupGracefulShutdown(app, () => repoRegistry, 1500);

app.on('window-all-closed', () => {
  // Финальный fallback: если before-quit не успел отработать (например, окно
  // закрыли через kill), дочищаем синхронно. После disposeAllGracefully
  // map уже пуст и killAll-цикл no-op.
  repoRegistry?.disposeAll();
  // Worker_threads пула: иначе на Windows процесс electron живёт ещё пару
  // секунд после закрытия окна, пока worker'ы не доиграют свой event loop.
  void import('../core/workers/WorkerPool').then(({ workerPool }) => workerPool.dispose());
  mainLogger.dispose();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
