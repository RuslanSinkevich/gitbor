import type { SelectHTMLAttributes } from 'react';

interface SgSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SgSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SgSelectOption[];
}

export function SgSelect({ label, options, className = '', id, ...rest }: SgSelectProps) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className={`sg-input-wrapper ${className}`.trim()}>
      {label && <label className="sg-input-label" htmlFor={selectId}>{label}</label>}
      <select className="sg-select" id={selectId} {...rest}>
        {options.map(opt => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
