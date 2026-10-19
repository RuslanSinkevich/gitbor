import { useEffect, useRef, useState } from 'react';

export interface SgToastAction {
  label: string;
  onClick(): void;
}

export interface SgToastData {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  /**
   * Опциональная кнопка-действие в тосте (например, Retry для network).
   * С кнопкой тост живёт дольше (см. toastDuration), но не вечно.
   */
  action?: SgToastAction;
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

/**
 * Сколько тост живёт, если `duration` не задан: по тому, сколько нужно
 * человеку. «Готово» читать нечего; ошибку нужно прочитать; с кнопкой
 * («Повторить», «Подробнее») — ещё и решить, нажимать ли. Раньше тост с
 * кнопкой висел вечно, а остальные, включая ошибки, жили 4 с.
 */
export function toastDuration(toast: Pick<SgToastData, 'type' | 'duration' | 'action'>): number {
  if (toast.duration) return toast.duration;
  if (toast.type === 'error') return toast.action ? 20_000 : 10_000;
  if (toast.type === 'warning') return toast.action ? 15_000 : 8_000;
  return toast.action ? 10_000 : 4_000;
}

function SgToast({ toast, onDismiss }: SgToastProps) {
  // Пока мышь над тостом — отсчёт стоит (не исчезает посреди чтения),
  // после — досчитывает остаток.
  const [hovered, setHovered] = useState(false);
  const remainingRef = useRef(toastDuration(toast));
  useEffect(() => {
    if (hovered) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(1_000, remainingRef.current - (Date.now() - startedAt));
    };
  }, [hovered, toast.id, onDismiss]);

  const message = decodeHtmlEntities(toast.message);

  return (
    <div
      className={`sg-toast sg-toast--${toast.type || 'info'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="sg-toast-message">{message}</span>
      {toast.action && (
        <button
          className="sg-toast-action sg-button sg-button--xs sg-button--ghost"
          onClick={() => { toast.action!.onClick(); onDismiss(toast.id); }}
        >
          {toast.action.label}
        </button>
      )}
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
