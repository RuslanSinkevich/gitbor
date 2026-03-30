import { useState, useCallback } from 'react';
import { SgButton, SgToastContainer } from '../../../ui';
import type { SgToastData } from '../../../ui/SgToast';

export function ToastSection() {
  const [toasts, setToasts] = useState<SgToastData[]>([]);

  const addToast = useCallback((type: SgToastData['type']) => {
    setToasts(prev => [...prev, { id: Date.now().toString(), message: `${type} notification`, type }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <>
      <div className="sg-showcase-section">
        <div className="sg-showcase-row">
          <SgButton variant="secondary" onClick={() => addToast('info')}>Info</SgButton>
          <SgButton variant="secondary" onClick={() => addToast('success')}>Success</SgButton>
          <SgButton variant="secondary" onClick={() => addToast('warning')}>Warning</SgButton>
          <SgButton variant="secondary" onClick={() => addToast('error')}>Error</SgButton>
        </div>
      </div>
      <SgToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
