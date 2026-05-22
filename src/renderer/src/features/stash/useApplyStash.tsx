import { useState, useCallback, type ReactNode } from 'react';
import { ApplyStashDialog } from './ApplyStashDialog';
import type { Stash } from '../../types';

export type RequestApplyStash = (stash: Stash) => void;

/**
 * Хук-обёртка для Apply Stash диалога. Сидит в App.tsx, прокидывается
 * вглубь до sidebarMenuItems / Sidebar (на double-click и пункт меню Apply...).
 */
export function useApplyStash(): { requestApplyStash: RequestApplyStash; applyStashDialog: ReactNode } {
  const [pending, setPending] = useState<Stash | null>(null);
  const requestApplyStash = useCallback((stash: Stash) => setPending(stash), []);
  const applyStashDialog = pending ? (
    <ApplyStashDialog
      stashIndex={pending.index}
      stashMessage={pending.message}
      onClose={() => setPending(null)}
    />
  ) : null;
  return { requestApplyStash, applyStashDialog };
}
