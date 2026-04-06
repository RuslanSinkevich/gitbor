import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as net from 'net';
import { buildMenu } from './menu';
import { initLang, setLang } from './i18n';
import { GitExecutor } from '../core/git/GitExecutor';
import { StateManager } from '../core/state/StateManager';
import { FileWatcher } from '../core/state/FileWatcher';
import { OperationQueue } from '../core/safety/OperationQueue';
import { OperationJournal } from '../core/safety/OperationJournal';
import { SafetyNet } from '../core/safety/SafetyNet';
import { CommandHandler } from '../core/commands/CommandHandler';
import { MessageBridge } from '../core/bridge/MessageBridge';
import { RecoveryManager } from '../core/safety/RecoveryManager';

let mainWindow: BrowserWindow | null = null;
let messageBridge: MessageBridge | null = null;
let fileWatcher: FileWatcher | null = null;
let commandHandler: CommandHandler | null = null;
let stateManager: StateManager | null = null;

const isDev = !app.isPackaged;

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

function rebuildMenu(): void {
  Menu.setApplicationMenu(buildMenu(() => {
    commandHandler?.openRepoDialog();
  }));
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
    stateManager?.getGit().killAll();
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
  const defaultCwd = process.cwd();

  const git = new GitExecutor(defaultCwd);

  const gitCheck = await RecoveryManager.checkGitAvailable(git);
  if (!gitCheck.available) {
    await RecoveryManager.showGitNotFoundMessage();
  }

  stateManager = new StateManager(git);
  const queue = new OperationQueue();
  const safety = new SafetyNet(git);
  commandHandler = new CommandHandler(git, queue, safety, stateManager);

  messageBridge = new MessageBridge(commandHandler, stateManager);

  fileWatcher = new FileWatcher(stateManager);

  stateManager.onRepoSwitch((repoPath) => {
    fileWatcher?.switchRepo(repoPath);
  });

  queue.onStatusChange((running, operation) => {
    stateManager!.setOperationRunning(running, operation);
  });
}

async function autoOpenRepo(): Promise<void> {
  if (!stateManager || !commandHandler || !fileWatcher) return;

  try {
    const git = stateManager.getGit();
    const checkGit = await git.exec(['rev-parse', '--show-toplevel']);
    if (checkGit.exitCode === 0) {
      const repoRoot = checkGit.stdout.trim().replace(/\//g, path.sep);
      stateManager.setRepoPath(repoRoot);
      await stateManager.switchRepo(repoRoot);
      fileWatcher.switchRepo(repoRoot);
    }
  } catch {
    // not a git repo — stay on welcome screen
  }

  try {
    const git = stateManager.getGit();
    const gitDir = path.join(git.getCwd(), '.git');
    const journal = new OperationJournal(gitDir);
    const safety = new SafetyNet(git);
    const recovery = new RecoveryManager(git, journal, safety);
    const report = await recovery.checkOnStartup();
    if (report.hasIssues) {
      await recovery.showRecoveryDialog(report);
    }
  } catch {
    // recovery check failed — non-fatal
  }
}

app.whenReady().then(async () => {
  initLang();

  await initServices();

  rebuildMenu();

  ipcMain.handle('skyfork:set-lang', (_event, lang: string) => {
    setLang(lang);
    rebuildMenu();
  });

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
  stateManager?.getGit().killAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
