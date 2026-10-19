import { useState, useEffect, useCallback } from 'react';
import type { SgToastAction, SgToastData } from '../ui/SgToast';

// Date.now() совпадал у двух тостов в одну миллисекунду: одинаковый key,
// и закрытие одного ломало другой.
let seq = 0;
const nextId = () => `${Date.now()}-${++seq}`;

export function useToasts(error: string | null, clearError: () => void) {
  const [toasts, setToasts] = useState<SgToastData[]>([]);

  useEffect(() => {
    if (!error) return;
    const id = nextId();
    setToasts(prev => {
      if (prev.some(t => t.message === error)) return prev;
      return [...prev, { id, message: error, type: 'error' as const }];
    });
    clearError();
  }, [error, clearError]);

  const addToast = useCallback((
    message: string,
    type: SgToastData['type'] = 'info',
    action?: SgToastAction,
  ) => {
    setToasts(prev => [...prev, { id: nextId(), message, type, action }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}
