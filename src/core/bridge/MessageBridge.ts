import { BrowserWindow, ipcMain } from 'electron';
import { CommandHandler } from '../commands/CommandHandler';
import { StateManager } from '../state/StateManager';
import { RendererCommand, MainEvent } from './messages';
import { gitActivityStore } from '../activity/GitActivityStore';
import { perfLog, approxJsonSize } from '../utils/perf';
import type { AiHandlers } from '../ai/AiHandlers';
import { AppError } from '../utils/AppError';
import type { HandlerContext } from './ipc/types';
import { ipcCommandHandlers } from './ipc/commandHandlers';

export class MessageBridge {
  private window: BrowserWindow | null = null;
  private unsubscribeState: (() => void) | null = null;
  private unsubscribeActivity: (() => void) | null = null;
  /**
   * Per-repo дедуп отправленного графа. Без него switchRepo A→B→A шлёт
   * весь graphData для каждого репо на каждое переключение (в MainProcess
   * applyRepoSnapshot создаёт «новую» ссылку, хотя данные идентичны).
   * При быстром туда-сюда 3-10 MB JSON'а в IPC-очереди накапливаются
   * и видятся пользователем как «тормоз» — IPC backlog блокирует
   * следующие сообщения. Храним пары commits/layout по repoPath;
   * если пришёл notify с тем же reference что мы уже слали для этого
   * репо — не шлём повторно. Renderer уже имеет данные в repoUiCache.
   */
  private sentGraphByRepo = new Map<string, {
    commits: ReturnType<StateManager['getState']>['commits'];
    layout: ReturnType<StateManager['getState']>['graphLayout'];
  }>();

  constructor(
    private readonly commandHandler: CommandHandler,
    private readonly stateManager: StateManager,
    private readonly aiHandlers: AiHandlers | null = null,
  ) {}

  attach(win: BrowserWindow): void {
    this.window = win;

    this.unsubscribeActivity = gitActivityStore.subscribe(event => {
      if (event.type === 'added') {
        this.send({ type: 'gitActivityAdded', entry: event.entry });
      } else if (event.type === 'updated') {
        this.send({ type: 'gitActivityUpdated', entry: event.entry });
      } else if (event.type === 'cleared') {
        this.send({ type: 'gitActivityCleared' });
      }
    });

    this.unsubscribeState = this.stateManager.subscribe(state => {
      const { commits, graphLayout, ...lightState } = state;
      this.send({ type: 'stateUpdate', data: lightState });

      const repoPath = state.repoPath;
      if (!repoPath) return;

      // Дедуп по repoPath: если для этого репо мы уже слали ровно эти
      // ссылки на commits/layout — не гоним 3-10 MB снова через IPC.
      const sent = this.sentGraphByRepo.get(repoPath);
      if (sent && sent.commits === commits && sent.layout === graphLayout) {
        return;
      }
      this.sentGraphByRepo.set(repoPath, { commits, layout: graphLayout });

      const payload: MainEvent = {
        type: 'graphData',
        data: { commits, layout: graphLayout },
        repoPath,
      };
      const size = approxJsonSize(payload.data);
      perfLog('IPC.graphData.send', {
        repo: repoPath,
        commits: commits.length,
        nodes: graphLayout.nodes.length,
        bytes: size,
        mb: (size / 1024 / 1024).toFixed(2),
      });
      this.send(payload);
    });

    ipcMain.handle('skyfork:command', (_event, command: unknown) => {
      return this.handleCommand(command);
    });

    win.on('closed', () => {
      this.dispose();
    });
  }

  send(event: MainEvent): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('skyfork:event', event);
    }
  }

  /**
   * Освободить ссылки на данные закрытого репо и сообщить renderer,
   * чтобы тот очистил свой repoUiCache. Без этого — утечка массивов
   * commits/layout на сессию (минорно, но для долгих сессий копится).
   */
  cleanupRepo(closedPath: string): void {
    this.sentGraphByRepo.delete(closedPath);
    this.send({ type: 'repoClosed', path: closedPath });
  }

  dispose(): void {
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }
    if (this.unsubscribeActivity) {
      this.unsubscribeActivity();
      this.unsubscribeActivity = null;
    }
    this.aiHandlers?.cancelAll();
    ipcMain.removeHandler('skyfork:command');
    this.sentGraphByRepo.clear();
    this.window = null;
  }

  private async handleCommand(command: unknown): Promise<void> {
    try {
      if (!command || typeof command !== 'object' || !('type' in command) || typeof (command as Record<string, unknown>).type !== 'string') {
        this.send({ type: 'error', message: 'Invalid command: missing or non-string type field' });
        return;
      }
      const cmd = command as RendererCommand;
      type AnyHandler = (cmd: RendererCommand, ctx: HandlerContext) => Promise<void>;
      const handler = ipcCommandHandlers[cmd.type] as AnyHandler | undefined;
      if (handler) {
        await handler(cmd, {
          ch: this.commandHandler,
          sm: this.stateManager,
          ai: this.aiHandlers,
          send: e => this.send(e),
        });
      } else {
        this.send({ type: 'error', message: `Unknown command: ${cmd.type}` });
      }
    } catch (error) {
      if (error instanceof AppError) {
        this.send({ type: 'error', message: error.message, code: error.code, data: error.data });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.send({ type: 'error', message });
    }
  }
}
