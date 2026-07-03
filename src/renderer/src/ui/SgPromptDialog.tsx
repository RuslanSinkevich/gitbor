import { useState, useCallback, useEffect } from 'react';
import { SgDialog } from './SgDialog';
import { t } from '../i18n';

/**
 * Два различных режима диалога:
 *  - `input`   — поле ввода + Cancel/Confirm; onConfirm получает строку.
 *  - `confirm` — только сообщение + Cancel/Confirm; onConfirm получает ''.
 *
 * РАНЬШЕ режим вычислялся из наличия `confirmLabel`, и любая кастомная
 * надпись на кнопке Confirm молча отбирала у диалога поле ввода. Это был
 * баг: см. stash из тулбара. Теперь kind задаётся явно, дефолт — input.
 */
interface PromptInputOptions {
  kind?: 'input';
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  allowEmpty?: boolean;
  onConfirm: (value: string) => void;
}

interface PromptCheckbox {
  label: string;
  /** Предупреждение, показывается когда чекбокс включён. */
  warning?: string;
}

interface PromptConfirmOptions {
  kind: 'confirm';
  title: string;
  message?: string;
  /** Опциональный список под сообщением (напр. «что нового» в обновлении). */
  bullets?: string[];
  /** Опциональный чекбокс (напр. «удалить untracked» в Discard All). */
  checkbox?: PromptCheckbox;
  confirmLabel?: string;
  danger?: boolean;
  /** При checkbox — аргумент true/false; без checkbox — вызов без аргумента. */
  onConfirm: (checkboxChecked?: boolean) => void;
}

export type ShowPromptOptions = PromptInputOptions | PromptConfirmOptions;
export type ShowPromptFn = (opts: ShowPromptOptions) => void;

interface PromptState {
  kind: 'input' | 'confirm';
  title: string;
  label: string;
  defaultValue: string;
  placeholder: string;
  message: string;
  bullets: string[];
  checkbox?: PromptCheckbox;
  confirmLabel: string;
  danger: boolean;
  allowEmpty: boolean;
  onConfirm: (value: string, checkboxChecked?: boolean) => void;
}

export function usePromptDialog() {
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  const showPrompt = useCallback<ShowPromptFn>((opts) => {
    if (opts.kind === 'confirm') {
      setPrompt({
        kind: 'confirm',
        title: opts.title,
        label: '',
        defaultValue: '',
        placeholder: '',
        message: opts.message ?? '',
        bullets: opts.bullets ?? [],
        checkbox: opts.checkbox,
        confirmLabel: opts.confirmLabel ?? '',
        danger: opts.danger ?? false,
        allowEmpty: true,
        onConfirm: (_value, checked) => opts.onConfirm(checked),
      });
      return;
    }
    setPrompt({
      kind: 'input',
      title: opts.title,
      label: opts.label ?? '',
      defaultValue: opts.defaultValue ?? '',
      placeholder: opts.placeholder ?? '',
      message: opts.message ?? '',
      bullets: [],
      confirmLabel: opts.confirmLabel ?? '',
      danger: opts.danger ?? false,
      allowEmpty: opts.allowEmpty ?? false,
      onConfirm: opts.onConfirm,
    });
  }, []);

  const closePrompt = useCallback(() => setPrompt(null), []);

  return { prompt, showPrompt, closePrompt };
}

interface SgPromptDialogProps {
  prompt: PromptState | null;
  onClose: () => void;
}

export function SgPromptDialog({ prompt, onClose }: SgPromptDialogProps) {
  const [value, setValue] = useState('');
  const [checkboxChecked, setCheckboxChecked] = useState(false);

  useEffect(() => {
    if (!prompt) return;
    setValue(prompt.defaultValue);
    setCheckboxChecked(false);
    // Фокус на input ставит autoFocus + showModal() — без таймера.
  }, [prompt]);

  if (!prompt) return null;

  const handleSubmit = () => {
    if (prompt.kind === 'confirm') {
      prompt.onConfirm('', prompt.checkbox ? checkboxChecked : undefined);
      onClose();
      return;
    }
    const trimmed = value.trim();
    if (!trimmed && !prompt.allowEmpty) return;
    prompt.onConfirm(trimmed);
    onClose();
  };

  const disabled = prompt.kind === 'input' && !prompt.allowEmpty && !value.trim();

  return (
    <SgDialog
      open={true}
      title={prompt.title}
      onClose={onClose}
      size="sm"
      onConfirm={handleSubmit}
      confirmLabel={prompt.confirmLabel || t().dialog.confirm}
      confirmDanger={prompt.danger}
      confirmDisabled={disabled}
    >
      {prompt.kind === 'confirm'
        ? (
            <>
              {prompt.message && (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--sg-foreground-muted)' }}>{prompt.message}</p>
              )}
              {prompt.bullets.length > 0 && (
                <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--sg-foreground-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {prompt.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
              {prompt.checkbox && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={checkboxChecked}
                    onChange={(e) => setCheckboxChecked(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span>{prompt.checkbox.label}</span>
                </label>
              )}
              {prompt.checkbox?.warning && checkboxChecked && (
                <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--sg-danger)' }}>
                  {prompt.checkbox.warning}
                </p>
              )}
            </>
          )
        : (
          <>
            {prompt.message && (
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--sg-foreground-muted)' }}>{prompt.message}</p>
            )}
            {prompt.label && <label style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>{prompt.label}</label>}
            <input
              autoFocus
              className="sg-input"
              value={value}
              onChange={e => setValue(e.target.value)}
              onPaste={prompt.placeholder === 'branch-name' ? (e) => {
                const text = e.clipboardData.getData('text');
                if (!text) return;
                e.preventDefault();
                const clean = text.replace(/\s+/g, '-').replace(/[~^:?*[\]\\"'«»]/g, '');
                const el = e.currentTarget;
                const a = el.selectionStart ?? value.length;
                const b = el.selectionEnd ?? value.length;
                setValue(value.slice(0, a) + clean + value.slice(b));
              } : undefined}
              placeholder={prompt.placeholder}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              style={{ width: '100%' }}
            />
          </>
        )
      }
    </SgDialog>
  );
}
