import { app, BrowserWindow, Menu, dialog, safeStorage } from 'electron';
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

let mainWindow: BrowserWindow | null = null;
let messageBridge: MessageBridge | null = null;
let fileWatcher: FileWatcher | null = null;
let commandHandler: CommandHandler | null = null;
let stateManager: StateManager | null = null;
let repoRegistry: RepoServicesRegistry | null = null;

const isDev = !app.isPackaged;

/**
 * Глобальный safety net: если что-то в main кинуло unhandledRejection или
 * uncaughtException (chokidar при EPERM/EACCES на системные папки, async
 * вне try/catch), мы НЕ роняем процесс. С `--unhandled-rejections=strict`
 * на новых нодах это иначе превращается в краш main + закрытие окна.
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
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
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

async function loadWindow(): Promise<void> {
  if (!mainWindow) return;
  if (isDev) {
    const devPort = Number(process.env.VITE_DEV_PORT || '5188');
    await waitForDevTcp(devPort);
    await mainWindow.loadURL(`http://127.0.0.1:${devPort}`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
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

  // Агрегированный «идёт операция» для UI — теперь объединяем по всем репо
  // (любая активная очередь в любом per-repo `OperationQueue` зажигает индикатор).
  repoRegistry.onAnyOperationStatusChange((running, operation) => {
    stateManager!.setOperationRunning(running, operation);
  });
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

  await loadWindow();

  await autoOpenRepo();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void (async () => {
        await createWindow();
        if (messageBridge && mainWindow) {
          messageBridge.attach(mainWindow);
        }
        await loadWindow();
      })();
    }
  });
});

app.on('window-all-closed', () => {
  repoRegistry?.disposeAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
