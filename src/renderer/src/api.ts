import type { RendererCommand, MainEvent } from './types';

interface SkyForkAPI {
  invoke(command: unknown): Promise<unknown>;
  onEvent(callback: (event: unknown) => void): void;
  offEvent(): void;
  onMenuAction?(callback: (action: string) => void): void;
  setLang(lang: string): Promise<void>;
  platform: string;
}

declare global {
  interface Window {
    skyForkAPI?: SkyForkAPI;
  }
}

function getAPI(): SkyForkAPI | null {
  return window.skyForkAPI ?? null;
}

export function postCommand(command: RendererCommand): void {
  const api = getAPI();
  if (api) {
    api.invoke(command).catch((err) => {
      console.error(`[SkyFork] IPC error for "${command.type}":`, err);
    });
  } else {
    console.warn('[SkyFork] No IPC bridge available, command:', command.type);
  }
}

type EventUnsubscribe = () => void;
const eventListeners = new Set<(event: MainEvent) => void>();
let globalListenerAttached = false;

function ensureGlobalListener(): void {
  if (globalListenerAttached) return;
  const api = getAPI();
  if (!api) return;
  globalListenerAttached = true;
  api.onEvent((data) => {
    const event = data as MainEvent;
    for (const listener of eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[SkyFork] Event listener error:', err);
      }
    }
  });
}

export function onMainEvent(callback: (event: MainEvent) => void): EventUnsubscribe {
  ensureGlobalListener();
  eventListeners.add(callback);
  return () => {
    eventListeners.delete(callback);
  };
}

export function sendReady(): void {
  postCommand({ type: 'ready' });
}

const menuListeners = new Set<(action: string) => void>();
let menuListenerAttached = false;

export function onMenuAction(callback: (action: string) => void): () => void {
  if (!menuListenerAttached) {
    const api = getAPI();
    if (api?.onMenuAction) {
      menuListenerAttached = true;
      api.onMenuAction((action) => {
        for (const listener of menuListeners) {
          try { listener(action); } catch { /* ignore */ }
        }
      });
    }
  }
  menuListeners.add(callback);
  return () => { menuListeners.delete(callback); };
}

export function setRemoteLang(lang: string): void {
  const api = getAPI();
  api?.setLang(lang);
}

export const isElectron = !!window.skyForkAPI;
