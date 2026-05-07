import type { CommandHandler } from '../../commands/CommandHandler';
import type { StateManager } from '../../state/StateManager';
import type { RendererCommand, MainEvent } from '../messages';
import type { AiHandlers } from '../../ai/AiHandlers';

export type CmdOf<K extends RendererCommand['type']> = Extract<RendererCommand, { type: K }>;

/**
 * Большинство IPC-обработчиков ничего не возвращают (используют `ctx.send`
 * для пуша event'ов в renderer). Но некоторые (`getRepoSummary` и т.п.) —
 * чисто запрос-ответные, и их результат пробрасывается напрямую в
 * `ipcMain.handle` → `invoke` в renderer. Поэтому возврат — `unknown`.
 */
export type HandlerTable = {
  [K in RendererCommand['type']]?: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<unknown>;
};

export interface HandlerContext {
  ch: CommandHandler;
  sm: StateManager;
  ai: AiHandlers | null;
  send: (event: MainEvent) => void;
}
