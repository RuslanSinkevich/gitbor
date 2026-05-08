import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../i18n';

interface SgDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function SgDialog({ open, title, onClose, children, footer, width = 480 }: SgDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
    <dialog ref={dialogRef} className="sg-dialog" style={{ width }}>
      <header className="sg-dialog-header">
        <h2 className="sg-dialog-title">{title}</h2>
        <button className="sg-dialog-close" onClick={onClose} aria-label={t().dialog.close}>&times;</button>
      </header>
      <div className="sg-dialog-body">{children}</div>
      {footer && <footer className="sg-dialog-footer">{footer}</footer>}
    </dialog>
  );
}
