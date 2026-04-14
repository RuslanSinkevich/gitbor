import { useState, useRef, useEffect, type ReactNode } from 'react';

interface SgTooltipProps {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

export function SgTooltip({ text, position = 'top', children }: SgTooltipProps) {
  const [visible, setVisible] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timeout.current), []);

  const show = () => {
    timeout.current = setTimeout(() => setVisible(true), 400);
  };
  const hide = () => {
    clearTimeout(timeout.current);
    setVisible(false);
  };

  return (
    <div className="sg-tooltip-wrapper" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div className={`sg-tooltip sg-tooltip--${position}`}>{text}</div>
      )}
    </div>
  );
}
