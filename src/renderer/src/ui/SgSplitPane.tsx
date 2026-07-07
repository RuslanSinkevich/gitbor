import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { loadStoredNumber, saveStoredNumber } from '../shared/uiPersist';

const HANDLE_PX = 1;

interface SgSplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  /** Минимальный размер противоположной (flex) панели в px — чтобы diff/нижняя секция не схлопнулись. */
  minOpposite?: number;
  direction?: 'horizontal' | 'vertical';
  /** Optional localStorage key to persist pane size between sessions. */
  storageKey?: string;
  /** Если true — при ресайзе контейнера (окна) размер панели меняется
      пропорционально, сохраняя долю от контейнера, а не абсолютные пиксели.
      Нужно для вертикальных сплитов, чтобы высоты панелей не «плыли». */
  proportional?: boolean;
}

export function SgSplitPane({
  left,
  right,
  defaultSize = 250,
  minSize = 150,
  maxSize = 600,
  minOpposite = 120,
  direction = 'horizontal',
  storageKey,
  proportional = false,
}: SgSplitPaneProps) {
  const clampSize = useCallback((value: number, total = 0) => {
    const maxFromContainer =
      total > 0 ? Math.max(minSize, total - minOpposite - HANDLE_PX) : maxSize;
    const upperBound = Math.min(maxSize, maxFromContainer);
    return Math.min(upperBound, Math.max(minSize, value));
  }, [minSize, maxSize, minOpposite]);

  const readStoredSize = useCallback(() => {
    if (!storageKey) return defaultSize;
    const stored = loadStoredNumber(storageKey);
    return stored !== null ? clampSize(stored) : defaultSize;
  }, [storageKey, defaultSize, clampSize]);

  const [size, setSize] = useState(() => readStoredSize());
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Последний измеренный размер контейнера — база для пропорции при ресайзе. */
  const prevTotalRef = useRef(0);

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
      const delta = (isH ? e.clientX : e.clientY) - startPos.current;
      const next = clampSize(startSize.current + delta, total);
      setSize(next);
    };
    const onMouseUp = () => { dragging.current = false; };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [direction, clampSize]);

  useEffect(() => {
    setSize(readStoredSize());
  }, [readStoredSize]);

  useEffect(() => {
    if (!storageKey) return;
    saveStoredNumber(storageKey, size);
  }, [size, storageKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const isH = direction === 'horizontal';
    const observer = new ResizeObserver(() => {
      const total = isH ? root.clientWidth : root.clientHeight;
      if (total <= 0) return;
      // Захватываем прошлый размер контейнера до обновления ref, чтобы
      // функциональный setSize не словил уже перезаписанное значение (гонка).
      const prevTotal = prevTotalRef.current;
      prevTotalRef.current = total;
      setSize(prev => {
        // Пропорция считается только на реальном ресайзе (prevTotal>0) и не
        // во время перетаскивания планки — тогда контейнер не меняется.
        const scaled =
          proportional && prevTotal > 0 && !dragging.current
            ? prev * (total / prevTotal)
            : prev;
        return clampSize(scaled, total);
      });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [direction, clampSize, proportional]);

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
