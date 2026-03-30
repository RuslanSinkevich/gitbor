import type { InputHTMLAttributes } from 'react';

interface SgInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function SgInput({ label, error, className = '', id, ...rest }: SgInputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={`sg-input-wrapper ${error ? 'sg-input-wrapper--error' : ''} ${className}`.trim()}>
      {label && <label className="sg-input-label" htmlFor={inputId}>{label}</label>}
      <input className="sg-input" id={inputId} {...rest} />
      {error && <span className="sg-input-error">{error}</span>}
    </div>
  );
}
