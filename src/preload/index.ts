import { contextBridge, ipcRenderer } from 'electron';

export interface GitBorAPI {
  invoke(command: unknown): Promise<unknown>;
  onEvent(callback: (event: unknown) => void): void;
  offEvent(): void;
  platform: string;
}

type EventHandler = (_e: Electron.IpcRendererEvent, data: unknown) => void;
let currentHandler: EventHandler | null = null;

const api: GitBorAPI = {
  invoke: (command: unknown) =>
    ipcRenderer.invoke('gitbor:command', command),

  onEvent: (callback: (event: unknown) => void) => {
    const handler: EventHandler = (_e, data) => callback(data);
    ipcRenderer.on('gitbor:event', handler);
    currentHandler = handler;
  },

  offEvent: () => {
    if (currentHandler) {
      ipcRenderer.removeListener('gitbor:event', currentHandler);
      currentHandler = null;
    }
  },

  platform: process.platform,
};

contextBridge.exposeInMainWorld('gitBorAPI', api);
