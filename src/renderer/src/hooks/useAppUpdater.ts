import { useEffect } from 'react';
import { postCommand, onMainEvent } from '../api';
import { t, tpl, getLang } from '../i18n';
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
      // macOS: «скачать установщик» покажет appUpdateReady — второй диалог не нужен.
      if (msg.macInstaller) break;
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

/** macOS: ход ручной установки — скачивание, открытый установщик, ошибка. */
function handleMacInstaller(msg: Extract<MainEvent, { type: 'appUpdateMacInstaller' }>, showPrompt: ShowPromptFn): void {
  const loc = t();
  const base = { kind: 'confirm' as const, title: loc.appUpdater.title };
  if (msg.state === 'downloading') {
    showPrompt({ ...base, message: tpl(loc.appUpdater.macDownloading, { file: msg.file ?? '' }), confirmLabel: loc.dialog.close, onConfirm: () => {} });
  } else if (msg.state === 'opened') {
    showPrompt({ ...base, message: loc.appUpdater.macOpened, confirmLabel: loc.appUpdater.macQuit, onConfirm: () => { void postCommand({ type: 'appUpdateQuit' }); } });
  } else {
    showPrompt({
      ...base,
      message: tpl(loc.appUpdater.macFailed, { error: msg.error ?? '' }),
      confirmLabel: loc.appUpdater.macOpenRelease,
      // Внешние ссылки main открывает системным браузером (setWindowOpenHandler).
      onConfirm: () => { if (msg.releaseUrl) window.open(msg.releaseUrl, '_blank'); },
    });
  }
}

/** Диалоги автообновления — только renderer + i18n. */
export function useAppUpdater(showPrompt: ShowPromptFn): void {
  useEffect(() => {
    return onMainEvent((msg) => {
      if (msg.type === 'appUpdateReady') {
        const loc = t();
        const bullets = msg.notes ? (getLang() === 'en' ? msg.notes.en : msg.notes.ru) : [];
        showPrompt({
          kind: 'confirm',
          title: loc.appUpdater.title,
          message: tpl(msg.macInstaller ? loc.appUpdater.macReadyMessage : loc.appUpdater.restartMessage, { version: msg.version }),
          bullets,
          confirmLabel: msg.macInstaller ? loc.appUpdater.macDownload : loc.appUpdater.restartConfirm,
          onConfirm: () => {
            void postCommand({ type: 'appUpdateInstall' });
          },
        });
        return;
      }
      if (msg.type === 'appUpdateMacInstaller') {
        handleMacInstaller(msg, showPrompt);
        return;
      }
      if (msg.type === 'appUpdateManualResult') {
        handleManualResult(msg, showPrompt);
      }
    });
  }, [showPrompt]);
}
