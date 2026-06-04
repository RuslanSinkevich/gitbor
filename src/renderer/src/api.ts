import type { RendererCommand, MainEvent } from './types';
import { logger } from './shared/logger';

interface GitBorAPI {
  invoke(command: unknown): Promise<unknown>;
  onEvent(callback: (event: unknown) => void): void;
  offEvent(): void;
  platform: string;
  getAppVersion(): Promise<string>;
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

/**
 * Команды, которые НЕ имеет смысла "повторять" из retry-toast — это
 * вьюшные read-операции и подписки. Не запоминаем их, чтобы при ошибке
 * предыдущего write-op'а юзер случайно не запустил getRebaseTodo вместо
 * настоящего pull.
 */
const NON_RETRYABLE_TYPES = new Set<string>([
  'ready', 'getState', 'refreshAll',
  'getCommitDetails', 'getGraphData', 'getFileDiff', 'getFileText', 'getFileBlame', 'getFileHistory',
  'getSubmodules', 'submoduleUpdate', 'submoduleInit',
  'getRebaseTodo', 'getMergeState', 'getConflictContent',
  'getRepoSummary', 'getRepoStats', 'getDayCommits', 'getAuthorCodeStats',
  'getGitActivity', 'clearGitActivity',
  'openDiff', 'openMergeEditor', 'openFile', 'switchView',
  'openInExplorer', 'openInTerminal',
  'getRepoSettings', 'listSshKeys', 'getPublicKey', 'getLfsStatus',
  'getWorktrees', 'getHooks', 'getReflog',
  'getBisectStatus', 'getGitignore',
  'getCommitDiff',
  'aiGetConfig', 'aiSetConfig', 'aiTestConnection', 'aiGenerateCommitMessage', 'aiCancelGenerate',
  'aiTestPrompt', 'aiGetLastDebug', 'aiSuggestStashName', 'aiSemanticSearch',
  'aiExplainCommit', 'aiExplainReflog', 'aiAnalyzeConflict',
  'pickDirectory',
  'safetyResolve', 'killGitProcess', 'removeIndexLock', 'rollbackOperation',
]);

let _lastRetryable: RendererCommand | null = null;
type RetryListener = (cmd: RendererCommand) => void;
const retryListeners = new Set<RetryListener>();

/** Подписка на запоминание ретраябельных команд (для App-state). */
export function onRetryableCommand(listener: RetryListener): () => void {
  retryListeners.add(listener);
  return () => { retryListeners.delete(listener); };
}

export function getLastRetryableCommand(): RendererCommand | null {
  return _lastRetryable;
}

export function postCommand(command: RendererCommand, hooks?: PostCommandHooks): void {
  if (!NON_RETRYABLE_TYPES.has(command.type)) {
    _lastRetryable = command;
    for (const l of retryListeners) {
      try { l(command); } catch (err) { logger.error('retry listener error:', err); }
    }
  }

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
