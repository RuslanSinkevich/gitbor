import { useEffect, useId, useRef, useState } from 'react';
import { SgDialog } from '../../ui/SgDialog';
import { t, tpl } from '../../i18n';

export type CheckoutMode = 'keep' | 'stash' | 'discard';

interface CheckoutDialogProps {
  branch: string;
  /** Сколько локальных файлов под угрозой — пишется в hint, чтоб юзер понимал масштаб. */
  dirtyCount: number;
  onConfirm(mode: CheckoutMode): void;
  onCancel(): void;
}

/**
 * Fork-стиль модал для checkout при наличии локальных изменений.
 * Три радио + Checkout/Cancel. Default — `keep` (наименее разрушительный
 * вариант: git попытается перенести изменения, и если столкнётся с
 * перекрытием — упадёт с понятной ошибкой, юзер увидит SafetyDialog).
 */
export function CheckoutDialog({ branch, dirtyCount, onConfirm, onCancel }: CheckoutDialogProps) {
  const loc = t();
  const [mode, setMode] = useState<CheckoutMode>('keep');
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const tid = setTimeout(() => okRef.current?.focus(), 0);
    return () => clearTimeout(tid);
  }, []);

  return (
    <SgDialog
      open={true}
      title={tpl(loc.checkoutDialog.title, { branch })}
      onClose={onCancel}
      width={520}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="sg-button sg-button--md sg-button--ghost" onClick={onCancel}>
            {loc.checkoutDialog.cancel}
          </button>
          <button
            ref={okRef}
            className={`sg-button sg-button--md ${mode === 'discard' ? 'sg-button--danger' : 'sg-button--primary'}`}
            onClick={() => onConfirm(mode)}
          >
            {loc.checkoutDialog.confirm}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ opacity: 0.8 }}>
          {tpl(loc.checkoutDialog.intro, { count: String(dirtyCount) })}
        </div>
        <Option
          checked={mode === 'keep'}
          onChange={() => setMode('keep')}
          title={loc.checkoutDialog.keepTitle}
          hint={loc.checkoutDialog.keepHint}
        />
        <Option
          checked={mode === 'stash'}
          onChange={() => setMode('stash')}
          title={loc.checkoutDialog.stashTitle}
          hint={loc.checkoutDialog.stashHint}
        />
        <Option
          checked={mode === 'discard'}
          onChange={() => setMode('discard')}
          title={loc.checkoutDialog.discardTitle}
          hint={loc.checkoutDialog.discardHint}
          danger
        />
      </div>
    </SgDialog>
  );
}

interface OptionProps {
  checked: boolean;
  onChange(): void;
  title: string;
  hint: string;
  danger?: boolean;
}

function Option({ checked, onChange, title, hint, danger }: OptionProps) {
  const inputId = useId();
  return (
    <label
      htmlFor={inputId}
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 1fr',
        gap: 8,
        padding: 8,
        borderRadius: 6,
        background: checked ? 'var(--sg-bg-selected, rgba(127,127,127,0.08))' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <input id={inputId} type="radio" aria-label={title} checked={checked} onChange={onChange} style={{ marginTop: 4 }} />
      <div>
        <div style={{ fontWeight: 600, color: danger ? 'var(--sg-danger, #b00020)' : undefined }}>{title}</div>
        <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>{hint}</div>
      </div>
    </label>
  );
}
