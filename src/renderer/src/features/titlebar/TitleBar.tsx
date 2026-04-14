import { SgButton } from '../../ui';
import { MenuBar, type MenuGroup } from '../../ui/MenuBar';
import type { t } from '../../i18n';
import s from './TitleBar.module.css';

const isDev = import.meta.env.DEV;

type Page = 'app' | 'ui-kit';

interface Props {
  loc: ReturnType<typeof t>;
  page: Page;
  setPage: (p: Page) => void;
  lang: string;
  toggleLang: () => void;
  theme: string;
  toggleTheme: () => void;
  onMenuAction: (action: string) => void;
  onOpenRepo: () => void;
}

export function TitleBar({ loc, page, setPage, lang, toggleLang, theme, toggleTheme, onMenuAction, onOpenRepo }: Props) {
  const menus: MenuGroup[] = [
    {
      label: loc.menu.file,
      items: [
        { label: loc.menu.openRepo, accelerator: 'Ctrl+O', action: onOpenRepo },
        { type: 'separator', label: '' },
        { label: loc.menu.closeRepo, accelerator: 'Ctrl+W', action: () => onMenuAction('closeRepo') },
        { type: 'separator', label: '' },
        { label: loc.menu.sshKeys, action: () => onMenuAction('sshKeys') },
        { type: 'separator', label: '' },
        { label: loc.menu.exit, action: () => window.close() },
      ],
    },
    {
      label: loc.menu.edit,
      items: [
        { label: loc.menu.undo, accelerator: 'Ctrl+Z', action: () => document.execCommand('undo') },
        { label: loc.menu.redo, accelerator: 'Ctrl+Y', action: () => document.execCommand('redo') },
        { type: 'separator', label: '' },
        { label: loc.menu.cut, accelerator: 'Ctrl+X', action: () => document.execCommand('cut') },
        { label: loc.menu.copy, accelerator: 'Ctrl+C', action: () => document.execCommand('copy') },
        { label: loc.menu.paste, accelerator: 'Ctrl+V', action: () => navigator.clipboard.readText().then(t => document.execCommand('insertText', false, t)).catch(() => {}) },
      ],
    },
    {
      label: loc.menu.view,
      items: [
        { label: loc.menu.changes, accelerator: 'Ctrl+1', action: () => onMenuAction('viewChanges') },
        { label: loc.menu.graph, accelerator: 'Ctrl+2', action: () => onMenuAction('viewCommits') },
      ],
    },
    {
      label: loc.menu.repository,
      items: [
        { label: loc.menu.refresh, accelerator: 'F5', action: () => onMenuAction('refresh') },
        { type: 'separator', label: '' },
        { label: loc.menu.fetch, accelerator: 'Ctrl+Shift+F', action: () => onMenuAction('fetch') },
        { label: loc.menu.pull, accelerator: 'Ctrl+Shift+L', action: () => onMenuAction('pull') },
        { label: loc.menu.push, accelerator: 'Ctrl+Shift+U', action: () => onMenuAction('push') },
        { type: 'separator', label: '' },
        { label: loc.menu.stash, accelerator: 'Ctrl+Shift+S', action: () => onMenuAction('stash') },
        { label: loc.menu.stashPop, accelerator: 'Ctrl+Shift+A', action: () => onMenuAction('stashPop') },
        { type: 'separator', label: '' },
        { label: loc.menu.reflog, action: () => onMenuAction('reflog') },
        { label: loc.menu.bisect, action: () => onMenuAction('bisect') },
        { label: loc.menu.hooks, action: () => onMenuAction('hooks') },
        { label: loc.menu.worktrees, action: () => onMenuAction('worktrees') },
        { label: loc.menu.lfs, action: () => onMenuAction('lfs') },
        { label: loc.menu.gitignore ?? '.gitignore...', action: () => onMenuAction('gitignore') },
        { type: 'separator', label: '' },
        { label: loc.menu.openInExplorer, accelerator: 'Ctrl+Alt+O', action: () => onMenuAction('openInExplorer') },
        { label: loc.menu.openInTerminal, accelerator: 'Ctrl+Alt+T', action: () => onMenuAction('openInTerminal') },
        { type: 'separator', label: '' },
        { label: loc.menu.repoSettings, action: () => onMenuAction('repoSettings') },
      ],
    },
    {
      label: loc.menu.branch,
      items: [
        { label: loc.menu.newBranch, accelerator: 'Ctrl+Shift+N', action: () => onMenuAction('newBranch') },
        { label: loc.menu.merge, accelerator: 'Ctrl+M', action: () => onMenuAction('merge') },
      ],
    },
    {
      label: loc.menu.help,
      items: [
        { label: loc.menu.about, action: () => onMenuAction('about') },
        { label: loc.menu.docs, action: () => window.open('https://skycode-ai.ru', '_blank') },
      ],
    },
  ];

  return (
    <header className={s.titlebar}>
      <MenuBar menus={menus} />
      <div className={s.nav}>
        {isDev && (
          <>
            <SgButton variant={page === 'app' ? 'primary' : 'ghost'} size="sm" onClick={() => setPage('app')}>App</SgButton>
            <SgButton variant={page === 'ui-kit' ? 'primary' : 'ghost'} size="sm" onClick={() => setPage('ui-kit')}>{loc.showcase.title}</SgButton>
          </>
        )}
        <button className={s.langToggle} onClick={toggleLang} title={lang === 'en' ? 'Русский' : 'English'}>
          {lang === 'en' ? 'RU' : 'EN'}
        </button>
        <button className={s.themeToggle} onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  );
}
