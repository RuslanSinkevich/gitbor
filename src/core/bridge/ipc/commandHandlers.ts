import type { HandlerTable } from './types';
import { ipcHandlersState } from './handlersState';
import { ipcHandlersGitOps } from './handlersGitOps';
import { ipcHandlersRepoExtras } from './handlersRepoExtras';
import { ipcHandlersAi } from './handlersAi';

/** Полная таблица IPC-команд renderer → main. */
export const ipcCommandHandlers: HandlerTable = {
  ...ipcHandlersState,
  ...ipcHandlersGitOps,
  ...ipcHandlersRepoExtras,
  ...ipcHandlersAi,
};
