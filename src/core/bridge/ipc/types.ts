import type { CommandHandler } from '../../commands/CommandHandler';
import type { StateManager } from '../../state/StateManager';
import type { RendererCommand, MainEvent } from '../messages';
import type { AiHandlers } from '../../ai/AiHandlers';

export type CmdOf<K extends RendererCommand['type']> = Extract<RendererCommand, { type: K }>;

export type HandlerTable = {
  [K in RendererCommand['type']]?: (cmd: CmdOf<K>, ctx: HandlerContext) => Promise<void>;
};

export interface HandlerContext {
  ch: CommandHandler;
  sm: StateManager;
  ai: AiHandlers | null;
  send: (event: MainEvent) => void;
}
