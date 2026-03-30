import type { ReactNode } from 'react';

interface SgBadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
  className?: string;
}

export function SgBadge({ variant = 'default', children, className = '' }: SgBadgeProps) {
  return (
    <span className={`sg-badge sg-badge--${variant} ${className}`.trim()}>
      {children}
    </span>
  );
}
