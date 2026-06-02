import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { DiffMinimap } from './DiffMinimap';
import type { ChangeMark } from './diffRows';
import s from './DiffView.module.css';

interface Props {
  /** Версия контента: при изменении пересчитываем метки (diff/mode/ignoreWs). */
  version: unknown;
  /** Скроллируемое содержимое diff (inline/split). */
  children: ReactNode;
}

const MARK_TYPES: Record<string, ChangeMark['type']> = {
  add: 'add',
  remove: 'remove',
  modify: 'modify',
};

/**
 * Обёртка для невиртуализированных diff-видов (inline/split): добавляет
 * фиксированную полосу-обзор изменений справа (VS-style overview ruler).
 *
 * Метки берём не из модели, а измеряем реальные DOM-узлы с атрибутом
 * `data-diff-mark` относительно скролл-контейнера — это даёт точную привязку
 * с учётом hunk-заголовков и отступов блоков. Пересчёт меток — только на смену
 * контента/размера (не на каждый скролл), позиция вьюпорта — на скролл (дёшево).
 */
export function DiffScrollMinimap({ version, children }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [marks, setMarks] = useState<ChangeMark[]>([]);

  const recomputeMarks = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fullH = el.scrollHeight || 1;
    setContent(fullH);
    setViewport(el.clientHeight);
    const base = el.getBoundingClientRect().top - el.scrollTop;
    const nodes = el.querySelectorAll<HTMLElement>('[data-diff-mark]');
    const next: ChangeMark[] = [];
    nodes.forEach((n) => {
      const type = MARK_TYPES[n.dataset.diffMark ?? ''];
      if (!type) return;
      const top = n.getBoundingClientRect().top - base;
      next.push({ ratio: Math.min(1, Math.max(0, top / fullH)), type });
    });
    setMarks(next);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recomputeMarks();
    setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => recomputeMarks())
      : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [recomputeMarks, onScroll]);

  // Контент сменился (новый файл/режим/ignoreWs) — DOM перерисован, пересчёт.
  useEffect(() => { recomputeMarks(); }, [version, recomputeMarks]);

  const onSeek = useCallback((ratioTop: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(max, Math.max(0, ratioTop * el.scrollHeight - el.clientHeight / 2));
  }, []);

  return (
    <div className={s.wholeWrap}>
      <div className={s.diffScroll} ref={scrollRef}>
        {children}
      </div>
      {marks.length > 0 && (
        <DiffMinimap marks={marks} scrollTop={scrollTop} viewport={viewport} content={content} onSeek={onSeek} />
      )}
    </div>
  );
}
