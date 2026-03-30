import { contextBridge, ipcRenderer } from 'electron';

export interface SkyForkAPI {
  invoke(command: unknown): Promise<unknown>;
  onEvent(callback: (event: unknown) => void): void;
  offEvent(): void;
  onMenuAction(callback: (action: string) => void): void;
  setLang(lang: string): Promise<void>;
  platform: string;
}

const api: SkyForkAPI = {
  invoke: (command: unknown) =>
    ipcRenderer.invoke('skyfork:command', command),

  onEvent: (callback: (event: unknown) => void) => {
    ipcRenderer.on('skyfork:event', (_e, data) => callback(data));
  },

  offEvent: () => {
    ipcRenderer.removeAllListeners('skyfork:event');
  },

  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('skyfork:menu-action', (_e, action) => callback(action));
  },

  setLang: (lang: string) => ipcRenderer.invoke('skyfork:set-lang', lang),

  platform: process.platform,
};

contextBridge.exposeInMainWorld('skyForkAPI', api);
