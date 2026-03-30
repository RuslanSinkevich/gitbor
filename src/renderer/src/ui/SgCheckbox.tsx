import type { InputHTMLAttributes } from 'react';

interface SgCheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

export function SgCheckbox({ label, className = '', id, ...rest }: SgCheckboxProps) {
  const cbId = id || label.toLowerCase().replace(/\s+/g, '-');
  return (
    <label className={`sg-checkbox ${className}`.trim()} htmlFor={cbId}>
      <input type="checkbox" className="sg-checkbox-input" id={cbId} {...rest} />
      <span className="sg-checkbox-label">{label}</span>
    </label>
  );
}
