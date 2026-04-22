import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';

const HANDLE_PX = 4;

interface SgSplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  /** Минимальный размер противоположной (flex) панели в px — чтобы diff/нижняя секция не схлопнулись. */
  minOpposite?: number;
  direction?: 'horizontal' | 'vertical';
}

export function SgSplitPane({
  left,
  right,
  defaultSize = 250,
  minSize = 150,
  maxSize = 600,
  minOpposite = 120,
  direction = 'horizontal',
}: SgSplitPaneProps) {
  const [size, setSize] = useState(defaultSize);
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
    startSize.current = size;
    e.preventDefault();
  }, [size, direction]);

  useEffect(() => {
    const isH = direction === 'horizontal';
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const root = rootRef.current;
      const total = root
        ? (isH ? root.clientWidth : root.clientHeight)
        : 0;
      const maxFromContainer =
        total > 0 ? Math.max(minSize, total - minOpposite - HANDLE_PX) : maxSize;
      const upperBound = Math.min(maxSize, maxFromContainer);
      const delta = (isH ? e.clientX : e.clientY) - startPos.current;
      const next = Math.min(upperBound, Math.max(minSize, startSize.current + delta));
      setSize(next);
    };
    const onMouseUp = () => { dragging.current = false; };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [direction, minSize, maxSize, minOpposite]);

  const isH = direction === 'horizontal';

  return (
    <div ref={rootRef} className={`sg-split sg-split--${direction}`}>
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
