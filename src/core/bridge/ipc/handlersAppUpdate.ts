import type { HandlerContext } from './types';
import { installDownloadedUpdate, runManualUpdateCheck } from '../../../main/AppUpdater';

export const ipcHandlersAppUpdate = {
  checkForUpdates: async (_cmd: unknown, ctx: HandlerContext) => {
    await runManualUpdateCheck((event) => ctx.send(event));
  },

  appUpdateInstall: async () => {
    installDownloadedUpdate();
  },
};
