import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';

interface SgSplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  direction?: 'horizontal' | 'vertical';
}

export function SgSplitPane({
  left,
  right,
  defaultSize = 250,
  minSize = 150,
  maxSize = 600,
  direction = 'horizontal',
}: SgSplitPaneProps) {
  const [size, setSize] = useState(defaultSize);
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startSize.current = size;
    e.preventDefault();
  }, [size, direction]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = (direction === 'horizontal' ? e.clientX : e.clientY) - startPos.current;
      const next = Math.min(maxSize, Math.max(minSize, startSize.current + delta));
      setSize(next);
    };
    const onMouseUp = () => { dragging.current = false; };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [direction, minSize, maxSize]);

  const isH = direction === 'horizontal';

  return (
    <div className={`sg-split sg-split--${direction}`}>
      <div className="sg-split-pane" style={isH ? { width: size } : { height: size }}>
        {left}
      </div>
      <div className={`sg-split-handle sg-split-handle--${direction}`} onMouseDown={onMouseDown} />
      <div className="sg-split-pane sg-split-pane--fill">
        {right}
      </div>
    </div>
  );
}
