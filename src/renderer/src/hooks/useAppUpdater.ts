import { useEffect } from 'react';
import { postCommand, onMainEvent } from '../api';
import { t, tpl } from '../i18n';
import type { ShowPromptFn } from '../ui/SgPromptDialog';
import type { MainEvent } from '../types';

function handleManualResult(msg: Extract<MainEvent, { type: 'appUpdateManualResult' }>, showPrompt: ShowPromptFn): void {
  const loc = t();
  switch (msg.result) {
    case 'nsis-only':
      showPrompt({
        kind: 'confirm',
        title: loc.appUpdater.title,
        message: loc.appUpdater.nsisOnly,
        confirmLabel: loc.dialog.close,
        onConfirm: () => {},
      });
      break;
    case 'available':
      showPrompt({
        kind: 'confirm',
        title: loc.appUpdater.title,
        message: `${tpl(loc.appUpdater.availableMessage, { version: msg.version ?? '' })}\n${loc.appUpdater.availableDetail}`,
        confirmLabel: loc.dialog.close,
        onConfirm: () => {},
      });
      break;
    case 'up-to-date':
      showPrompt({
        kind: 'confirm',
        title: loc.appUpdater.title,
        message: tpl(loc.appUpdater.upToDate, { version: msg.current ?? '' }),
        confirmLabel: loc.dialog.close,
        onConfirm: () => {},
      });
      break;
    case 'error':
      showPrompt({
        kind: 'confirm',
        title: loc.appUpdater.title,
        message: msg.error ? `${loc.appUpdater.checkFailed}\n${msg.error}` : loc.appUpdater.checkFailed,
        confirmLabel: loc.dialog.close,
        onConfirm: () => {},
      });
      break;
  }
}

/** Диалоги автообновления — только renderer + i18n. */
export function useAppUpdater(showPrompt: ShowPromptFn): void {
  useEffect(() => {
    return onMainEvent((msg) => {
      if (msg.type === 'appUpdateReady') {
        const loc = t();
        showPrompt({
          kind: 'confirm',
          title: loc.appUpdater.title,
          message: tpl(loc.appUpdater.restartMessage, { version: msg.version }),
          confirmLabel: loc.appUpdater.restartConfirm,
          onConfirm: () => {
            void postCommand({ type: 'appUpdateInstall' });
          },
        });
        return;
      }
      if (msg.type === 'appUpdateManualResult') {
        handleManualResult(msg, showPrompt);
      }
    });
  }, [showPrompt]);
}
