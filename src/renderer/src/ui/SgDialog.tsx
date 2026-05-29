import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { t } from '../i18n';

export type SgDialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';

const SIZE_PX: Record<Exclude<SgDialogSize, 'fullscreen'>, number> = {
  sm: 380,
  md: 520,
  lg: 720,
  xl: 920,
};

interface SgDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Кастомная ширина в px (legacy). Лучше использовать `size`. */
  width?: number;
  /** Семантический размер. Имеет приоритет над `width` если задан вместе. */
  size?: SgDialogSize;
  /** Убрать внутренние отступы у body (для диалогов с табами/листами по краю). */
  noPadding?: boolean;
  /** Дополнительный контент в шапке справа (например, settings-cog). */
  headerExtra?: ReactNode;
  /**
   * Готовый footer Cancel + Confirm. Если задан — переопределяет `footer`.
   * Когда нужен полностью кастомный — используем `footer`.
   */
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  confirmDanger?: boolean;
  /** Спиннер на кнопке подтверждения (долгая операция). */
  confirmLoading?: boolean;
  /** Идентификатор описания (aria-describedby) для скринридеров. */
  describedById?: string;
  /** Куда поставить начальный фокус (по умолчанию <dialog> ставит на первый focusable). */
  initialFocus?: RefObject<HTMLElement | null>;
}

/**
 * Modal-обёртка над нативным <dialog>. Используется .showModal() — браузер
 * имплементирует focus-trap, role="dialog" + aria-modal и возврат фокуса
 * на триггер автоматически. Esc обрабатывается через 'cancel' event с
 * preventDefault, чтобы родитель успел убрать state.
 */
export function SgDialog({
  open, title, onClose, children, footer, width,
  size, noPadding, headerExtra,
  onConfirm, confirmLabel, cancelLabel, confirmDisabled, confirmDanger, confirmLoading,
  describedById, initialFocus,
}: SgDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const loc = t();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // showModal() сам ставит фокус по HTML-spec (autofocus или первый
      // focusable). Если потребитель явно указал initialFocus —
      // переставляем сразу после showModal, без setTimeout 0.
      if (initialFocus?.current) initialFocus.current.focus();
    }
    if (!open && el.open) el.close();
  }, [open, initialFocus]);

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

  const style: React.CSSProperties = size === 'fullscreen'
    ? { width: 'calc(100vw - 32px)', height: 'calc(100vh - 32px)', maxWidth: 'none' }
    : { width: size ? SIZE_PX[size] : (width ?? 480) };

  const effectiveFooter = onConfirm
    ? (
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          className="sg-button sg-button--md sg-button--ghost"
          onClick={onClose}
          disabled={confirmLoading}
        >
          {cancelLabel ?? loc.dialog.cancel}
        </button>
        <button
          className={`sg-button sg-button--md sg-button--${confirmDanger ? 'danger' : 'primary'}`}
          onClick={onConfirm}
          disabled={confirmDisabled || confirmLoading}
        >
          <span className="sg-button-content">
            {confirmLoading && <span className="sg-button-spinner" aria-hidden="true" />}
            {confirmLabel ?? loc.dialog.confirm}
          </span>
        </button>
      </div>
    )
    : footer;

  return (
    <dialog
      ref={dialogRef}
      className="sg-dialog"
      style={style}
      aria-labelledby={titleId}
      aria-describedby={describedById}
    >
      <header className="sg-dialog-header">
        <h2 className="sg-dialog-title" id={titleId}>{title}</h2>
        {headerExtra && <div className="sg-dialog-header-extra">{headerExtra}</div>}
        <button className="sg-dialog-close" onClick={onClose} aria-label={loc.dialog.close}>&times;</button>
      </header>
      <div
        className="sg-dialog-body"
        style={noPadding ? { padding: 0 } : undefined}
      >
        {children}
      </div>
      {effectiveFooter && <footer className="sg-dialog-footer">{effectiveFooter}</footer>}
    </dialog>
  );
}
