# 15 — IPC Bridge (Electron)

## Слой: Bridge Layer
## Файл: `src/main/IpcBridge.ts`
## Зависимости: types.ts, messages.ts, CommandHandler, StateManager

---

## Назначение

Мост между Renderer Process (React) и Main Process (Node.js) через Electron IPC.
Принимает команды от Renderer через `ipcMain.handle`, рассылает события через `webContents.send`.

Заменяет MessageBridge из SkyFork (который использовал postMessage для webview).

## Интерфейс

```typescript
class IpcBridge {
  constructor(
    private commandHandler: CommandHandler,
    private stateManager: StateManager,
    private conflictManager: ConflictManager
  ) {
    stateManager.subscribe((state) => {
      this.broadcast({ type: 'stateUpdate', data: state });
    });
  }

  registerHandlers(): void

  setMainWindow(window: BrowserWindow): void

  broadcast(event: ExtensionEvent): void
}
```

## Preload Script

Мост безопасности между Main и Renderer:

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('SkyForkAPI', {
  invoke: (command: string, payload?: any) =>
    ipcRenderer.invoke('SkyFork:command', command, payload),

  onEvent: (callback: (event: ExtensionEvent) => void) => {
    ipcRenderer.on('SkyFork:event', (_e, data) => callback(data));
  },

  offEvent: () => {
    ipcRenderer.removeAllListeners('SkyFork:event');
  },
});
```

## Регистрация IPC обработчиков (Main Process)

```typescript
import { ipcMain, BrowserWindow } from 'electron';

class IpcBridge {
  private mainWindow: BrowserWindow | null = null;

  registerHandlers(): void {
    ipcMain.handle('SkyFork:command', async (_event, command: string, payload?: any) => {
      return this.handleCommand({ type: command, ...payload });
    });
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  broadcast(event: ExtensionEvent): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('SkyFork:event', event);
    }
  }
}
```

## Маршрутизация команд

```typescript
private async handleCommand(command: WebviewCommand): Promise<any> {
  try {
    switch (command.type) {
      case 'ready':
        return this.stateManager.getState();

      case 'getState':
        return this.stateManager.getState();

      case 'checkout':
        this.broadcast({ type: 'operationStart', operation: 'checkout' });
        const result = await this.commandHandler.checkout(command.branch);
        this.broadcast({
          type: 'operationEnd',
          operation: 'checkout',
          success: result.success,
          error: result.error
        });
        return result;

      case 'getCommitDetails':
        return this.commandHandler.getCommitDetails(command.hash);

      case 'getDiff':
        return this.commandHandler.getDiff(command.file, command.hash);

      case 'getFileDiff':
        return this.commandHandler.getFileDiff(command.file, command.staged);

      case 'startMerge':
        return this.conflictManager.merge(command.source, command.options);

      case 'resolveWithOurs':
        return this.conflictManager.resolveWithOurs(command.file);

      case 'resolveWithTheirs':
        return this.conflictManager.resolveWithTheirs(command.file);

      case 'completeMerge':
        return this.conflictManager.completeMerge(command.message);

      case 'abortMerge':
        return this.conflictManager.abortMerge();

      case 'openFileInEditor':
        // Electron: открыть файл в системном редакторе
        const { shell } = require('electron');
        shell.openPath(path.join(this.stateManager.getState().repoPath, command.file));
        return;

      case 'openInFileManager':
        const { shell: s } = require('electron');
        s.showItemInFolder(command.path);
        return;

      // ... остальные команды аналогично
    }
  } catch (error) {
    this.broadcast({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
```

## Renderer: использование API

```typescript
// В React-компонентах:
const state = await window.SkyForkAPI.invoke('getState');
await window.SkyForkAPI.invoke('checkout', { branch: 'main' });
await window.SkyForkAPI.invoke('commit', { message: 'fix bug', amend: false });

// Подписка на события:
window.SkyForkAPI.onEvent((event) => {
  switch (event.type) {
    case 'fullState': setState(event.data); break;
    case 'stateUpdate': mergeState(event.data); break;
    case 'operationStart': setLoading(true); break;
    case 'operationEnd': setLoading(false); break;
    case 'error': showNotification(event.message); break;
  }
});
```

## Типизация window.SkyForkAPI

```typescript
// src/preload/types.ts
interface SkyForkAPI {
  invoke(command: string, payload?: any): Promise<any>
  onEvent(callback: (event: ExtensionEvent) => void): void
  offEvent(): void
}

declare global {
  interface Window {
    SkyForkAPI: SkyForkAPI
  }
}
```

## Отличия от SkyFork MessageBridge

| SkyFork (VS Code) | SkyFork (Electron) |
|---|---|
| `webview.postMessage(event)` | `webContents.send('SkyFork:event', event)` |
| `webview.onDidReceiveMessage(msg)` | `ipcMain.handle('SkyFork:command', ...)` |
| Два webview (sidebar + full view) | Один BrowserWindow |
| `contextBridge` не нужен | `contextBridge.exposeInMainWorld` обязателен |

## Edge Cases

- Окно закрыто → broadcast ничего не делает (проверка `isDestroyed()`)
- Ошибка в обработке → broadcast error → UI показывает уведомление
- Renderer отправил команду до ready → getState() вернёт начальное состояние
