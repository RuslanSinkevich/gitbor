import { useEffect } from 'react';

export interface SgToastData {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

interface SgToastProps {
  toast: SgToastData;
  onDismiss: (id: string) => void;
}

function decodeHtmlEntities(input: string): string {
  if (!input.includes('&')) return input;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = input;
  return textarea.value;
}

export function SgToast({ toast, onDismiss }: SgToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration || 4000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const message = decodeHtmlEntities(toast.message);

  return (
    <div className={`sg-toast sg-toast--${toast.type || 'info'}`}>
      <span className="sg-toast-message">{message}</span>
      <button className="sg-toast-close" onClick={() => onDismiss(toast.id)}>&times;</button>
    </div>
  );
}

interface SgToastContainerProps {
  toasts: SgToastData[];
  onDismiss: (id: string) => void;
}

export function SgToastContainer({ toasts, onDismiss }: SgToastContainerProps) {
  return (
    <div className="sg-toast-container">
      {toasts.map(t => <SgToast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}
