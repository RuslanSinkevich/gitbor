import { useEffect, useId, useRef, type ReactNode } from 'react';
import { t } from '../i18n';

interface SgDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/**
 * Modal-обёртка над нативным <dialog>. Используется .showModal() — браузер
 * имплементирует focus-trap, role="dialog" + aria-modal и возврат фокуса
 * на триггер автоматически. Через `aria-labelledby` связываем заголовок,
 * чтобы скринридер озвучивал название при открытии.
 *
 * Esc обрабатывается через 'cancel' event (preventDefault, чтобы не дать
 * dialog'у мгновенно скрыться без вызова onClose — это позволяет родителю
 * корректно убрать state).
 */
export function SgDialog({ open, title, onClose, children, footer, width = 480 }: SgDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', handleCancel);
    return () => el.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog ref={dialogRef} className="sg-dialog" style={{ width }} aria-labelledby={titleId}>
      <header className="sg-dialog-header">
        <h2 className="sg-dialog-title" id={titleId}>{title}</h2>
        <button className="sg-dialog-close" onClick={onClose} aria-label={t().dialog.close}>&times;</button>
      </header>
      <div className="sg-dialog-body">{children}</div>
      {footer && <footer className="sg-dialog-footer">{footer}</footer>}
    </dialog>
  );
}
