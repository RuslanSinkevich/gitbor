import { useCallback, useState, type ReactNode } from 'react';
import { postCommand } from '../../api';
import { CheckoutDialog, type CheckoutMode } from './CheckoutDialog';

export type RequestCheckout = (branch: string) => void;

/**
 * Перехват checkout при непустом working tree: Fork-диалог keep/stash/discard.
 * Без локальных изменений — сразу `postCommand` (режим по умолчанию на backend).
 */
export function useCheckout(hasLocalChanges: boolean, dirtyCount: number): {
  requestCheckout: RequestCheckout;
  checkoutDialog: ReactNode | null;
} {
  const [pending, setPending] = useState<{ branch: string } | null>(null);

  const requestCheckout = useCallback((branch: string) => {
    if (!hasLocalChanges) {
      postCommand({ type: 'checkout', branch });
      return;
    }
    setPending({ branch });
  }, [hasLocalChanges]);

  const checkoutDialog = pending ? (
    <CheckoutDialog
      branch={pending.branch}
      dirtyCount={dirtyCount}
      onConfirm={(mode: CheckoutMode) => {
        postCommand({ type: 'checkout', branch: pending.branch, mode });
        setPending(null);
      }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { requestCheckout, checkoutDialog };
}
