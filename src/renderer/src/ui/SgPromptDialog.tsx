import { useState, useCallback, useRef, useEffect } from 'react';
import { SgDialog } from './SgDialog';
import { t } from '../i18n';

interface PromptState {
  title: string;
  label: string;
  defaultValue: string;
  placeholder: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  /** Разрешить submit с пустой строкой. По умолчанию false — кнопка disabled пока поле пустое. */
  allowEmpty: boolean;
  onConfirm: (value: string) => void;
}

export interface ShowPromptOptions {
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

export type ShowPromptFn = (opts: ShowPromptOptions) => void;

export function usePromptDialog() {
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  const showPrompt = useCallback<ShowPromptFn>((opts) => {
    setPrompt({
      title: opts.title,
      label: opts.label ?? '',
      defaultValue: opts.defaultValue ?? '',
      placeholder: opts.placeholder ?? '',
      message: opts.message ?? '',
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
  const inputRef = useRef<HTMLInputElement>(null);

  const isConfirmOnly = !!prompt?.confirmLabel;

  useEffect(() => {
    if (prompt) {
      setValue(prompt.defaultValue);
      if (!isConfirmOnly) {
        const timer = setTimeout(() => inputRef.current?.focus(), 50);
        return () => clearTimeout(timer);
      }
    }
  }, [prompt, isConfirmOnly]);

  if (!prompt) return null;

  const handleSubmit = () => {
    if (isConfirmOnly) {
      prompt.onConfirm('');
      onClose();
      return;
    }
    const trimmed = value.trim();
    if (!trimmed && !prompt.allowEmpty) return;
    prompt.onConfirm(trimmed);
    onClose();
  };

  const confirmBtnClass = prompt.danger
    ? 'sg-button sg-button--md sg-button--danger'
    : 'sg-button sg-button--md sg-button--primary';

  return (
    <SgDialog open={true} title={prompt.title} onClose={onClose} width={400} footer={
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="sg-button sg-button--md sg-button--ghost" onClick={onClose}>{t().dialog.cancel}</button>
        <button
          className={confirmBtnClass}
          onClick={handleSubmit}
          disabled={!isConfirmOnly && !prompt.allowEmpty && !value.trim()}
        >
          {prompt.confirmLabel || t().dialog.confirm}
        </button>
      </div>
    }>
      {isConfirmOnly ? (
        prompt.message && <p style={{ margin: 0, fontSize: 13, color: 'var(--sg-foreground-muted)' }}>{prompt.message}</p>
      ) : (
        <>
          {prompt.label && <label style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>{prompt.label}</label>}
          <input
            ref={inputRef}
            className="sg-input"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={prompt.placeholder}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            style={{ width: '100%' }}
          />
        </>
      )}
    </SgDialog>
  );
}
