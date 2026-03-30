import { useState, useCallback, useRef, useEffect } from 'react';
import { SgDialog } from './SgDialog';

interface PromptState {
  title: string;
  label: string;
  defaultValue: string;
  placeholder: string;
  onConfirm: (value: string) => void;
}

export function usePromptDialog() {
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  const showPrompt = useCallback((opts: {
    title: string;
    label?: string;
    defaultValue?: string;
    placeholder?: string;
    onConfirm: (value: string) => void;
  }) => {
    setPrompt({
      title: opts.title,
      label: opts.label ?? '',
      defaultValue: opts.defaultValue ?? '',
      placeholder: opts.placeholder ?? '',
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

  useEffect(() => {
    if (prompt) {
      setValue(prompt.defaultValue);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [prompt]);

  if (!prompt) return null;

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    prompt.onConfirm(trimmed);
    onClose();
  };

  return (
    <SgDialog open={true} title={prompt.title} onClose={onClose} width={400} footer={
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="sg-btn sg-btn--ghost" onClick={onClose}>Cancel</button>
        <button className="sg-btn sg-btn--primary" onClick={handleSubmit} disabled={!value.trim()}>OK</button>
      </div>
    }>
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
    </SgDialog>
  );
}
