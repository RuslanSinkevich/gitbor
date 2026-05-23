import { app, BrowserWindow, Menu, dialog, safeStorage, session, shell } from 'electron';
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
import { attachLongPathSuggester } from '../core/safety/LongPathSuggester';
import { AiService } from '../core/ai/AiService';
import { AiConfigStore } from '../core/ai/AiConfigStore';
import { AiDebugStore } from '../core/ai/AiDebugStore';
import { AiHandlers } from '../core/ai/AiHandlers';
import { configureMainLogger, mainLogger } from '../core/utils/Logger';
import { setupGracefulShutdown } from './gracefulShutdown';
import { computeAiOrigins } from './cspOrigins';

let mainWindow: BrowserWindow | null = null;
let messageBridge: MessageBridge | null = null;
let fileWatcher: FileWatcher | null = null;
let commandHandler: CommandHandler | null = null;
let stateManager: StateManager | null = null;
let repoRegistry: RepoServicesRegistry | null = null;
let aiService: AiService | null = null;

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
  console.error('[GitBor] unhandledRejection:', msg);
});
process.on('uncaughtException', (err) => {
  console.error('[GitBor] uncaughtException:', err instanceof Error ? err.stack ?? err.message : err);
});

// На Linux под Wayland Electron по дефолту работает через XWayland — это
// заметно деградирует HiDPI и вводит лишний layer. `auto` оставляет Electron'у
// право выбрать X11, если Wayland недоступен (без жёсткого требования).
// Guard по `process.platform === 'linux'` исключает влияние на Win/macOS.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

/**
 * Sanity-check что Vite dev-server слушает порт. Вызывается один раз
 * перед `loadURL`. Раньше тут был цикл с `setTimeout(250)` retry до
 * 45 секунд — но `scripts/wait-dev-server.mjs` УЖЕ блокирует запуск
 * Electron'а до того как Vite поднялся (см. `npm run dev:main`).
 *
 * К моменту, когда main.ts вызывает эту функцию, порт гарантированно
 * жив — race возможен только если Vite успел упасть между exit'ом
 * wait-script и запуском Electron'а (~100ms окно). В этом случае
 * лучше упасть сразу с понятной ошибкой, чем 45 секунд молча
 * пытаться. Никаких таймеров — один TCP connect.
 */
function checkDevTcp(port: number, host = '127.0.0.1'): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host });
    socket.once('connect', () => {
      socket.end();
      resolve();
    });
    socket.once('error', () => {
      socket.destroy();
      reject(
        new Error(
          `Dev server не отвечает на ${host}:${port}. Запустите «npm run dev» целиком или освободите порт ${port} (strictPort в Vite).`,
        ),
      );
    });
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'GitBor',
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

  // Останавливаем фоновую активность пока окно скрыто/свёрнуто. Без этого
  // за многочасовые сессии накапливалось: рендер-heap (React fibers,
  // graph layout), очередь fs-событий chokidar и срабатывания auto-fetch
  // каждые 5 минут × N репо. Заметно тормозило при restore.
  //
  // `blur`/`focus` НЕ ловим: потеря фокуса при переключении на другой
  // app — это не «скрыто», окно по-прежнему видно. Пауза только когда
  // действительно не на экране.
  const onWindowHidden = (): void => {
    fileWatcher?.pause();
    messageBridge?.send({ type: 'windowVisibility', visible: false });
  };
  const onWindowVisible = (): void => {
    fileWatcher?.resume();
    messageBridge?.send({ type: 'windowVisibility', visible: true });
  };
  mainWindow.on('minimize', onWindowHidden);
  mainWindow.on('hide', onWindowHidden);
  mainWindow.on('restore', onWindowVisible);
  mainWindow.on('show', onWindowVisible);

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
 * Распакованный `electron .`: Vite только если явно GITBOR_VITE=1 (npm run dev),
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

  if (process.env.GITBOR_VITE === '1') {
    await checkDevTcp(devPort);
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

/**
 * Возвращает `aborted: true` только в одном кейсе: git не найден И пользователь
 * выбрал «Закрыть» в `showGitNotFoundMessage`. В этом случае вызывающий код
 * (whenReady-callback) обязан сделать ранний `return` ДО создания окна — иначе
 * GitBor покажет мёртвый welcome-экран после `app.quit()` (quit асинхронный,
 * пара тиков остаётся на выполнение остального колбэка).
 */
async function initServices(): Promise<{ aborted: boolean }> {
  // Бутстрапный GitExecutor — только для проверки наличия git в PATH.
  // Реальные операции на репо идут через per-repo services в registry.
  const probeGit = new GitExecutor(process.cwd());
  const gitCheck = await checkGitAvailable(probeGit);
  if (!gitCheck.available) {
    const { shouldQuit } = await showGitNotFoundMessage();
    if (shouldQuit) {
      app.quit();
      return { aborted: true };
    }
    // shouldQuit=false — пользователь ушёл качать git; UI поднимаем как
    // обычно, дальнейшие git-зависимые операции упадут штатно через
    // их собственные error paths.
  }

  // На Windows глубокие репо валятся в Filename too long, пока не выставлен
  // core.longpaths=true. При первом совпадении показываем диалог-подсказку.
  attachLongPathSuggester(probeGit);

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
  aiService = new AiService(aiStore.load());
  const aiDebug = new AiDebugStore(app.getPath('userData'));
  const aiHandlers = new AiHandlers(aiService, aiStore, aiDebug);

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

  return { aborted: false };
}

async function autoOpenRepo(): Promise<void> {
  if (!stateManager || !commandHandler || !fileWatcher) return;

  // Auto-open из `process.cwd()` — это dev-удобство (`npm start` из корня
  // репо). В упакованном prod-билде cwd = папка ярлыка / `%USERPROFILE%`,
  // что регулярно открывало случайный «домашний» git (dotfiles в `~`,
  // система контроля версий у инструментов и т.п.). Сессия восстанавливается
  // из localStorage в renderer'е через `loadOpenRepos`, никакого auto-open
  // в проде не нужно.
  if (app.isPackaged) return;

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

/**
 * HTTP-header CSP, накладываемый на ответы для renderer'а (file:// в prod,
 * loopback в dev). Это второй слой поверх HTML-meta CSP в `index.html`:
 * meta задаёт строгий жёсткий минимум, header динамически расширяет
 * `connect-src` ровно на те AI-origin'ы, что соответствуют текущему
 * AiProviderConfig (см. `computeAiOrigins`).
 *
 * Скоуп URL'ов:
 * - file:// — прод-загрузка index.html и его ассетов.
 * - http://127.0.0.1:* и http://localhost:* — dev/HMR Vite (порт 5188 по
 *   умолчанию). На внешние домены (включая AI-API) hook не вешает CSP —
 *   там CSP не имеет смысла, ответ всё равно потребляет main process.
 *
 * DEV vs PROD:
 * - В dev (`!app.isPackaged`) hook вообще пропускает запрос (callback({})),
 *   оставляя действовать только HTML-meta DEV_CSP с `unsafe-inline`/
 *   `unsafe-eval` и широким `connect-src` для HMR ws://. Иначе Vite HMR
 *   ляжет, и dev-режим станет неюзабельным.
 * - В prod hook инжектит жёсткий CSP с `connect-src 'self' <ai-origin>`,
 *   перекрывая meta `connect-src 'self' https:` ровно на нужные origin'ы.
 *
 * Пересчёт: hook вызывается на каждый response, конфиг читается через
 * `aiService.getConfig()` (in-memory, обновляется через `aiSetConfig` IPC
 * без перезапуска). Поэтому смена AI-провайдера в UI сразу отражается на
 * следующем запросе.
 */
function registerCspHook(): void {
  if (!app.isPackaged) {
    mainLogger.debug('CSP header hook: skipped (dev mode)');
    return;
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url;
    const isLocalScheme =
      url.startsWith('file://') ||
      url.startsWith('http://localhost:') ||
      url.startsWith('http://127.0.0.1:');
    if (!isLocalScheme) {
      callback({});
      return;
    }

    const cfg = aiService?.getConfig() ?? null;
    const aiOriginsList = computeAiOrigins(cfg);
    const aiOrigins = aiOriginsList.join(' ');
    const connectSrc = aiOrigins ? `connect-src 'self' ${aiOrigins}` : "connect-src 'self'";

    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      connectSrc,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ');

    // Удаляем чужие CSP-заголовки (на всякий случай, если ассет вернёт свой)
    // и инжектим единственный наш — Electron не мерджит несколько CSP, при
    // дублировании работает самый строгий из набора.
    const headers: Record<string, string[] | string> = {};
    const src = details.responseHeaders ?? {};
    for (const [key, value] of Object.entries(src)) {
      if (key.toLowerCase() === 'content-security-policy') continue;
      if (value !== undefined) headers[key] = value;
    }
    headers['Content-Security-Policy'] = [csp];

    callback({ responseHeaders: headers });
  });
}

app.whenReady().then(async () => {
  configureMainLogger({ isProduction: app.isPackaged });
  mainLogger.debug(`startup: pid=${process.pid} platform=${process.platform} packaged=${app.isPackaged}`);

  try {
    const { initSafetyStats } = await import('../core/safety/SafetyStats');
    initSafetyStats(app.getPath('userData'));
  } catch (err) {
    mainLogger.warn(`safetyStats init failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  Menu.setApplicationMenu(null);

  // Параллелим тяжёлые шаги стартапа:
  //   createWindow (GPU init, BrowserWindow alloc) ║ initServices (git --version, StateManager, AI)
  // Раньше последовательно → 3-5 с белого экрана. Теперь оба процесса идут
  // одновременно. `attach(messageBridge)` дёргаем ПОСЛЕ createWindow, но
  // ДО loadWindow — чтобы ipcMain.handle был зарегистрирован к моменту,
  // когда renderer запустит первый postCommand из React-useEffect.
  const windowCreated = (async () => {
    try {
      await createWindow();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dialog.showErrorBox('GitBor', msg);
      app.quit();
      return false;
    }
  })();

  const { aborted } = await initServices();
  if (aborted) return;

  registerCspHook();

  const winOk = await windowCreated;
  if (!winOk) return;

  if (messageBridge && mainWindow) {
    messageBridge.attach(mainWindow);
  }

  try {
    await loadWindow();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    dialog.showErrorBox('GitBor', msg);
    app.quit();
    return;
  }

  // Не блокирует первое отображение: окно уже видно (ready-to-show
  // отрабатывает на загруженном DOM), autoOpenRepo дальше работает в фоне
  // и шлёт `stateUpdate` через уже подключённый messageBridge.
  void autoOpenRepo();

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
          dialog.showErrorBox('GitBor', msg);
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
