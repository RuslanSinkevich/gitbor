import type { TextareaHTMLAttributes } from 'react';

interface SgTextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function SgTextArea({ label, error, className = '', id, ...rest }: SgTextAreaProps) {
  const areaId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={`sg-input-wrapper ${error ? 'sg-input-wrapper--error' : ''} ${className}`.trim()}>
      {label && <label className="sg-input-label" htmlFor={areaId}>{label}</label>}
      <textarea className="sg-textarea" id={areaId} {...rest} />
      {error && <span className="sg-input-error">{error}</span>}
    </div>
  );
}
