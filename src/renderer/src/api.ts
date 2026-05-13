import type { RendererCommand, MainEvent } from './types';
import { logger } from './shared/logger';

interface GitBorAPI {
  invoke(command: unknown): Promise<unknown>;
  onEvent(callback: (event: unknown) => void): void;
  offEvent(): void;
  platform: string;
}

declare global {
  interface Window {
    gitBorAPI?: GitBorAPI;
  }
}

function getAPI(): GitBorAPI | null {
  return window.gitBorAPI ?? null;
}

export interface PostCommandHooks {
  /** Called only when `ipcRenderer.invoke` rejects (no main handler completion). Main `error` events use `onMainEvent`. */
  onInvokeRejected?: () => void;
}

export function postCommand(command: RendererCommand, hooks?: PostCommandHooks): void {
  const api = getAPI();
  if (api) {
    void api.invoke(command).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`IPC error for "${command.type}":`, msg);
      hooks?.onInvokeRejected?.();
    });
  } else {
    logger.warn('No IPC bridge available, command:', command.type);
    hooks?.onInvokeRejected?.();
  }
}

/**
 * Промис-версия postCommand: возвращает результат IPC. Использовать когда
 * нужно ловить успешность/ошибку (например, при восстановлении last repo
 * чтобы почистить localStorage если путь невалиден).
 */
export function invokeCommand(command: RendererCommand): Promise<unknown> {
  const api = getAPI();
  if (!api) return Promise.reject(new Error('GitBor IPC недоступен'));
  return api.invoke(command);
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
        logger.error('Event listener error:', err);
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

export const isElectron = !!window.gitBorAPI;

/** Safe clipboard write — silently catches permission/security errors. */
export function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {});
}
