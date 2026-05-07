import { shell } from 'electron';
import type { HandlerContext } from './types';

/**
 * Path-based shell-команды (вариация на тему openInExplorer, но с явным
 * `path` вместо неявного «активный репо»). Нужно для контекстного меню
 * вкладок: правый клик по неактивному табу → «Открыть в проводнике»
 * должен открывать именно ТУ папку, а не активный репо.
 *
 * Команды зарегистрированы в `commandHandlers.ts` через слабую типизацию
 * (Record<string, ...>): тип команды НЕ добавлен в `RendererCommand`
 * union в `messages.ts`, чтобы не конфликтовать с параллельной работой
 * над файлом. Renderer шлёт команду через cast `as unknown as RendererCommand`.
 */
interface OpenPathInExplorerCmd {
  type: 'openPathInExplorer';
  path: string;
}

async function openPathInExplorer(cmd: OpenPathInExplorerCmd): Promise<void> {
  if (!cmd.path || typeof cmd.path !== 'string') return;
  try {
    await shell.openPath(cmd.path);
  } catch {
    // shell.openPath обычно не кидает (он возвращает строку с ошибкой),
    // но try/catch страхует от платформ-специфичных исключений, чтобы
    // main не упал из-за невалидного path.
  }
}

type LooseHandler = (cmd: unknown, ctx: HandlerContext) => Promise<void>;

export const ipcHandlersShell: Record<string, LooseHandler> = {
  openPathInExplorer: (cmd) => openPathInExplorer(cmd as OpenPathInExplorerCmd),
};
