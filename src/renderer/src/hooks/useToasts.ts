import { useState, useEffect, useCallback } from 'react';
import type { SgToastData } from '../ui/SgToast';

export function useToasts(error: string | null, clearError: () => void) {
  const [toasts, setToasts] = useState<SgToastData[]>([]);

  useEffect(() => {
    if (!error) return;
    const id = Date.now().toString();
    setToasts(prev => {
      if (prev.some(t => t.message === error)) return prev;
      return [...prev, { id, message: error, type: 'error' as const }];
    });
    clearError();
  }, [error, clearError]);

  const addToast = useCallback((message: string, type: SgToastData['type'] = 'info') => {
    setToasts(prev => [...prev, { id: Date.now().toString(), message, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}
