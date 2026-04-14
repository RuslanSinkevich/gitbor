import { contextBridge, ipcRenderer } from 'electron';

export interface SkyForkAPI {
  invoke(command: unknown): Promise<unknown>;
  onEvent(callback: (event: unknown) => void): void;
  offEvent(): void;
  platform: string;
}

type EventHandler = (_e: Electron.IpcRendererEvent, data: unknown) => void;
let currentHandler: EventHandler | null = null;

const api: SkyForkAPI = {
  invoke: (command: unknown) =>
    ipcRenderer.invoke('skyfork:command', command),

  onEvent: (callback: (event: unknown) => void) => {
    const handler: EventHandler = (_e, data) => callback(data);
    ipcRenderer.on('skyfork:event', handler);
    currentHandler = handler;
  },

  offEvent: () => {
    if (currentHandler) {
      ipcRenderer.removeListener('skyfork:event', currentHandler);
      currentHandler = null;
    }
  },

  platform: process.platform,
};

contextBridge.exposeInMainWorld('skyForkAPI', api);
