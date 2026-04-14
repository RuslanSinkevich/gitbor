import { useEffect } from 'react';
import { postCommand } from '../api';

export function useKeyboardShortcuts(dispatch: (action: string) => void) {
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
        switch (key) {
          case 'O': e.preventDefault(); postCommand({ type: 'openRepoDialog' }); return;
          case 'W': e.preventDefault(); dispatch('closeRepo'); return;
          case 'M': e.preventDefault(); dispatch('merge'); return;
          case '1': e.preventDefault(); dispatch('viewChanges'); return;
          case '2': e.preventDefault(); dispatch('viewCommits'); return;
        }
      }

    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch]);
}
