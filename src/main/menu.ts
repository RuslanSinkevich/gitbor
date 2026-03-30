import { BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron';
import { t } from './i18n';

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}

export function buildMenu(onOpenRepo?: () => void): Menu {
  const loc = t();

  const template: MenuItemConstructorOptions[] = [
    {
      label: loc.menu.file,
      submenu: [
        { label: loc.menu.openRepo, accelerator: 'CmdOrCtrl+O', click: () => onOpenRepo?.() },
        { type: 'separator' },
        {
          label: loc.menu.closeRepo, accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.close();
          },
        },
        { type: 'separator' },
        { role: 'quit', label: loc.menu.exit },
      ],
    },
    {
      label: loc.menu.edit,
      submenu: [
        { role: 'undo', label: loc.menu.undo },
        { role: 'redo', label: loc.menu.redo },
        { type: 'separator' },
        { role: 'cut', label: loc.menu.cut },
        { role: 'copy', label: loc.menu.copy },
        { role: 'paste', label: loc.menu.paste },
      ],
    },
    {
      label: loc.menu.view,
      submenu: [
        {
          label: loc.menu.changes, accelerator: 'CmdOrCtrl+1',
          click: () => sendToRenderer('skyfork:event', { type: 'showView', view: 'changes' }),
        },
        {
          label: loc.menu.graph, accelerator: 'CmdOrCtrl+2',
          click: () => sendToRenderer('skyfork:event', { type: 'showView', view: 'commits' }),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
    {
      label: loc.menu.repository,
      submenu: [
        { label: loc.menu.fetch, accelerator: 'CmdOrCtrl+Shift+F', click: () => sendToRenderer('skyfork:menu-action', 'fetch') },
        { label: loc.menu.pull, accelerator: 'CmdOrCtrl+Shift+P', click: () => sendToRenderer('skyfork:menu-action', 'pull') },
        { label: loc.menu.push, accelerator: 'CmdOrCtrl+Shift+U', click: () => sendToRenderer('skyfork:menu-action', 'push') },
        { type: 'separator' },
        { label: loc.menu.stash, accelerator: 'CmdOrCtrl+Shift+S', click: () => sendToRenderer('skyfork:menu-action', 'stash') },
        { label: loc.menu.stashPop, accelerator: 'CmdOrCtrl+Shift+A', click: () => sendToRenderer('skyfork:menu-action', 'stashPop') },
      ],
    },
    {
      label: loc.menu.branch,
      submenu: [
        { label: loc.menu.newBranch, accelerator: 'CmdOrCtrl+Shift+N', click: () => sendToRenderer('skyfork:menu-action', 'newBranch') },
        { label: loc.menu.merge, accelerator: 'CmdOrCtrl+M', click: () => sendToRenderer('skyfork:menu-action', 'merge') },
      ],
    },
    {
      label: loc.menu.help,
      submenu: [
        { label: loc.menu.about, click: () => sendToRenderer('skyfork:menu-action', 'about') },
        {
          label: loc.menu.docs,
          click: () => { shell.openExternal('https://skycode-ai.ru'); },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
