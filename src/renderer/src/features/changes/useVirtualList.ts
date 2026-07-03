import { useCallback, useEffect, useRef, useState } from 'react';

const OVERSCAN = 12;

export interface VirtualRange {
  start: number;
  end: number;
}

/**
 * Простейшая вертикальная виртуализация списка фиксированной высоты строки.
 * Держит собственный scroll-контейнер (`bodyRef`) и отдаёт видимый диапазон
 * индексов [start, end). Пересчитывает диапазон на scroll, resize контейнера
 * и при изменении totalCount/rowHeight (напр. развернули папку — список стал
 * длиннее). Отдельный хук, а не graph/useVirtualScroll: у графа своя
 * фиксированная ROW_HEIGHT и логика памяти скролла, здесь это лишнее.
 */
export function useVirtualList(totalCount: number, rowHeight: number) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<VirtualRange>({ start: 0, end: 50 });

  const update = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const { scrollTop, clientHeight } = el;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const end = Math.min(totalCount, Math.ceil((scrollTop + clientHeight) / rowHeight) + OVERSCAN);
    setRange(prev => (prev.start === start && prev.end === end) ? prev : { start, end });
  }, [totalCount, rowHeight]);

  useEffect(() => { update(); }, [update]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => update();
    el.addEventListener('scroll', onScroll, { passive: true });

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => update());
      ro.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [update]);

  return { bodyRef, range };
}
