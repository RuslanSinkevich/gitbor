import type { HandlerContext } from './types';
import { installDownloadedUpdate, quitForMacInstall, runManualUpdateCheck } from '../../../main/AppUpdater';

export const ipcHandlersAppUpdate = {
  checkForUpdates: async (_cmd: unknown, ctx: HandlerContext) => {
    await runManualUpdateCheck((event) => ctx.send(event));
  },

  appUpdateInstall: async (_cmd: unknown, ctx: HandlerContext) => {
    installDownloadedUpdate((event) => ctx.send(event));
  },

  appUpdateQuit: async () => {
    quitForMacInstall();
  },
};
