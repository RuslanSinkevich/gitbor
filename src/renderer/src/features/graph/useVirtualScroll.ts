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

  // Clamp scroll при уменьшении списка. Без этого при переходе с большого
  // репо (15k коммитов, scrollTop=50000) на маленький (39 коммитов, totalHeight
  // ~1090px) расчёт даёт start=1785, end=39 → пустой visibleCommits на один
  // кадр, пока браузер сам не клэмпнет scrollTop. Визуально это и есть тот
  // «скачок» при переходе большой→маленький.
  const prevTotalRef = useRef(totalCount);
  useEffect(() => {
    if (prevTotalRef.current !== totalCount) {
      const el = bodyRef.current;
      if (el) {
        const maxScroll = Math.max(0, totalCount * ROW_HEIGHT - el.clientHeight);
        if (el.scrollTop > maxScroll) el.scrollTop = maxScroll;
      }
      prevTotalRef.current = totalCount;
    }
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
    // Instant вместо smooth: smooth-scroll к далёкому коммиту занимает
    // 500-1500мс анимации (это именно те длинные полосы в Performance
    // Animations-треке, которые читаются как «тормоз» при переключении
    // между репо, если у другого репо сохранён selectedCommitHash).
    el.scrollTop = Math.max(0, targetY);
  }, []);

  return { bodyRef, visibleRange, scrollToRow };
}
