import type { HandlerTable } from './types';
import { ipcHandlersState } from './handlersState';
import { ipcHandlersGitOps } from './handlersGitOps';
import { ipcHandlersRepoExtras } from './handlersRepoExtras';
import { ipcHandlersAi } from './handlersAi';
import { ipcHandlersShell } from './handlersShell';
import { ipcHandlersSafety } from './handlersSafety';

/** Полная таблица IPC-команд renderer → main. */
export const ipcCommandHandlers: HandlerTable = {
  ...ipcHandlersState,
  ...ipcHandlersGitOps,
  ...ipcHandlersRepoExtras,
  ...ipcHandlersAi,
  ...ipcHandlersSafety,
  // openPathInExplorer и пр. команды НЕ описаны в `RendererCommand` union
  // (см. handlersShell.ts), поэтому таблица расширяется через cast — тип
  // не позволяет добавить новый ключ к строгой `HandlerTable`.
  ...(ipcHandlersShell as Partial<HandlerTable>),
};
