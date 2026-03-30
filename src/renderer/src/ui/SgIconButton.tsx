import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface SgIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip?: string;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function SgIconButton({
  tooltip,
  size = 'md',
  className = '',
  children,
  ...rest
}: SgIconButtonProps) {
  return (
    <button
      className={`sg-icon-button sg-icon-button--${size} ${className}`.trim()}
      title={tooltip}
      {...rest}
    >
      {children}
    </button>
  );
}
