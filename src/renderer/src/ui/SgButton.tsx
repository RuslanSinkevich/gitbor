import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface SgButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function SgButton({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: SgButtonProps) {
  return (
    <button
      className={`sg-button sg-button--${variant} sg-button--${size} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
