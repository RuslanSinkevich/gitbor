import { useEffect } from 'react';
import { postCommand } from '../api';

/**
 * Per-tab actions, передаются из App.tsx (там живут openRepos и
 * switchRepoFast). Опционально: useKeyboardShortcuts продолжает работать
 * даже если хост-компонент таб-handler'ы не передал — тогда таб-хоткеи
 * просто игнорируются.
 */
export interface TabKeyboardActions {
  /** Переключиться на N-й (0-based) таб. Игнор если N >= openReposCount. */
  switchToTab: (index: number) => void;
  /** Циклически следующий/предыдущий таб. */
  nextTab: () => void;
  prevTab: () => void;
  /** Текущее число открытых репо — нужно чтобы отсечь Ctrl+N для несуществующих. */
  openReposCount: number;
}

export function useKeyboardShortcuts(
  dispatch: (action: string) => void,
  tabActions?: TabKeyboardActions,
) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;
      const key = e.key.toUpperCase();

      if (e.key === 'F5') {
        e.preventDefault();
        dispatch('refresh');
        return;
      }

      if (isEditable) return;
      if (!ctrl) return;

      // Tab navigation: Ctrl+Tab → следующий, Ctrl+Shift+Tab → предыдущий.
      // В Electron Ctrl+Tab не зарезервирован за браузером (нет UI-табов),
      // preventDefault страхует от любых системных перехватов.
      if (e.key === 'Tab' && tabActions) {
        if (tabActions.openReposCount <= 1) return;
        e.preventDefault();
        if (shift) tabActions.prevTab();
        else tabActions.nextTab();
        return;
      }

      if (shift) {
        switch (key) {
          case 'F': e.preventDefault(); dispatch('fetch'); return;
          case 'L': e.preventDefault(); dispatch('pull'); return;
          case 'U': e.preventDefault(); dispatch('push'); return;
          case 'S': e.preventDefault(); dispatch('stash'); return;
          case 'A': e.preventDefault(); dispatch('stashPop'); return;
          case 'N': e.preventDefault(); dispatch('newBranch'); return;
        }
      }

      if (alt) {
        switch (key) {
          case 'O': e.preventDefault(); dispatch('openInExplorer'); return;
          case 'T': e.preventDefault(); dispatch('openInTerminal'); return;
        }
      }

      if (!shift && !alt) {
        // Ctrl+1..9 → переключение на N-й таб. Бывшие Ctrl+1/Ctrl+2
        // (viewChanges/viewCommits) перенесены под этот биндинг — см.
        // «Принятые решения» в ответе ассистента.
        if (e.key >= '1' && e.key <= '9' && tabActions) {
          const tabIndex = Number(e.key) - 1;
          if (tabIndex < tabActions.openReposCount) {
            e.preventDefault();
            tabActions.switchToTab(tabIndex);
            return;
          }
        }

        switch (key) {
          case 'O': e.preventDefault(); postCommand({ type: 'openRepoDialog' }); return;
          case 'W': e.preventDefault(); dispatch('closeRepo'); return;
          case 'M': e.preventDefault(); dispatch('merge'); return;
        }
      }

    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch, tabActions]);
}
