import type { RendererCommand, MainEvent } from './types';

interface SkyForkAPI {
  invoke(command: unknown): Promise<unknown>;
  onEvent(callback: (event: unknown) => void): void;
  offEvent(): void;
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

export const isElectron = !!window.skyForkAPI;

/** Safe clipboard write — silently catches permission/security errors. */
export function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {});
}
