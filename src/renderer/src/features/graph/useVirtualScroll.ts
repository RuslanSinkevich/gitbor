import { useRef, useState, useCallback, useEffect } from 'react';
import { ROW_HEIGHT, OVERSCAN } from './graphConstants';

export function useVirtualScroll(totalCount: number) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  const updateVisibleRange = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewHeight = el.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(totalCount, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);
    setVisibleRange(prev => (prev.start === start && prev.end === end) ? prev : { start, end });
  }, [totalCount]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    updateVisibleRange();
    el.addEventListener('scroll', updateVisibleRange, { passive: true });
    return () => el.removeEventListener('scroll', updateVisibleRange);
  }, [updateVisibleRange]);

  const scrollToRow = useCallback((row: number) => {
    const el = bodyRef.current;
    if (!el) return;
    const targetY = row * ROW_HEIGHT - el.clientHeight / 2 + ROW_HEIGHT / 2;
    el.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
  }, []);

  return { bodyRef, visibleRange, scrollToRow };
}
