import { useState, useRef, useEffect, useLayoutEffect, useCallback, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

const GAP = 6;
const SHOW_DELAY = 400;

interface SgTooltipProps {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Max width (px) for multiline tooltips. Omit for single-line tips. */
  maxWidth?: number;
  children: ReactNode;
}

function computeStyle(position: NonNullable<SgTooltipProps['position']>, rect: DOMRect): CSSProperties {
  switch (position) {
    case 'left':
      return {
        top: rect.top + rect.height / 2,
        left: rect.left - GAP,
        transform: 'translate(-100%, -50%)',
      };
    case 'right':
      return {
        top: rect.top + rect.height / 2,
        left: rect.right + GAP,
        transform: 'translateY(-50%)',
      };
    case 'bottom':
      return {
        top: rect.bottom + GAP,
        left: rect.left + rect.width / 2,
        transform: 'translateX(-50%)',
      };
    case 'top':
    default:
      return {
        top: rect.top - GAP,
        left: rect.left + rect.width / 2,
        transform: 'translate(-50%, -100%)',
      };
  }
}

export function SgTooltip({ text, position = 'top', maxWidth, children }: SgTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => () => clearTimeout(timeout.current), []);

  const reposition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setStyle(computeStyle(position, el.getBoundingClientRect()));
  }, [position]);

  const show = () => {
    timeout.current = setTimeout(() => {
      reposition();
      setVisible(true);
    }, SHOW_DELAY);
  };
  const hide = () => {
    clearTimeout(timeout.current);
    setVisible(false);
  };

  useLayoutEffect(() => {
    if (!visible) return;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [visible, reposition]);

  return (
    <span ref={anchorRef} className="sg-tooltip-wrapper" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && createPortal(
        <div
          className={`sg-tooltip sg-tooltip--portal${maxWidth !== undefined ? ' sg-tooltip--multiline' : ''}`}
          style={{ ...style, maxWidth: maxWidth ?? undefined }}
          role="tooltip"
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}
