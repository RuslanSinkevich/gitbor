import { contextBridge, ipcRenderer } from 'electron';

export interface SkyForkAPI {
  invoke(command: unknown): Promise<unknown>;
  onEvent(callback: (event: unknown) => void): void;
  offEvent(): void;
  platform: string;
}

const api: SkyForkAPI = {
  invoke: (command: unknown) =>
    ipcRenderer.invoke('skyfork:command', command),

  onEvent: (callback: (event: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('skyfork:event', handler);
    (api as any)._eventHandler = handler;
  },

  offEvent: () => {
    const handler = (api as any)._eventHandler;
    if (handler) {
      ipcRenderer.removeListener('skyfork:event', handler);
      (api as any)._eventHandler = null;
    }
  },

  platform: process.platform,
};

contextBridge.exposeInMainWorld('skyForkAPI', api);
