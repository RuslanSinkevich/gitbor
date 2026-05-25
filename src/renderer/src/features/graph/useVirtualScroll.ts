import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { ROW_HEIGHT, OVERSCAN } from './graphConstants';

/**
 * Сохранённые scrollTop'ы в разрезе scopeKey (обычно — repoPath). Память
 * процесс-локальная: при переключении репо/таба возвращаем юзера туда же,
 * где он был, а не на верх. Map переживает unmount компонента (модуль-
 * левел), поэтому смена layout/панели тоже не теряет позицию.
 */
const scrollMemory = new Map<string, number>();

export function useVirtualScroll(totalCount: number, scopeKey: string = '__default__') {
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

  // Сохраняем scrollTop пользователя на каждый scroll и сразу пишем в общий
  // scrollMemory в разрезе текущего scopeKey. Так смена репо туда-обратно
  // возвращает юзера в ту же точку, где он был.
  const lastScrollTopRef = useRef(scrollMemory.get(scopeKey) ?? 0);
  const onScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;
    scrollMemory.set(scopeKey, el.scrollTop);
    updateVisibleRange();
  }, [updateVisibleRange, scopeKey]);

  // При смене scopeKey (переключение репо) — подтягиваем сохранённый
  // scrollTop из памяти и применяем синхронно перед paint. Если для этого
  // ключа памяти нет (первый раз) — стартуем с 0.
  const prevScopeRef = useRef(scopeKey);
  useLayoutEffect(() => {
    if (prevScopeRef.current === scopeKey) return;
    const el = bodyRef.current;
    prevScopeRef.current = scopeKey;
    const remembered = scrollMemory.get(scopeKey) ?? 0;
    lastScrollTopRef.current = remembered;
    if (el) {
      const maxScroll = Math.max(0, totalCount * ROW_HEIGHT - el.clientHeight);
      el.scrollTop = Math.min(remembered, maxScroll);
    }
  }, [scopeKey, totalCount]);

  // Защита от прыжка наверх при периодических refresh'ах в рамках одного
  // репо: новый `commits` массив → React пере-рендерит → в части движков
  // scrollTop сбрасывается в 0. Возвращаем последний известный.
  const prevTotalRef = useRef(totalCount);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const prevTotal = prevTotalRef.current;
    const maxScroll = Math.max(0, totalCount * ROW_HEIGHT - el.clientHeight);
    if (prevTotal !== totalCount) {
      if (el.scrollTop > maxScroll) {
        el.scrollTop = maxScroll;
        lastScrollTopRef.current = maxScroll;
        scrollMemory.set(scopeKey, maxScroll);
      } else if (el.scrollTop !== lastScrollTopRef.current && lastScrollTopRef.current <= maxScroll) {
        el.scrollTop = lastScrollTopRef.current;
      }
      prevTotalRef.current = totalCount;
    } else if (
      el.scrollTop !== lastScrollTopRef.current
      && lastScrollTopRef.current <= maxScroll
      && lastScrollTopRef.current > 0
    ) {
      el.scrollTop = lastScrollTopRef.current;
    }
  });

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    updateVisibleRange();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [onScroll, updateVisibleRange]);

  const scrollToRow = useCallback((row: number) => {
    const el = bodyRef.current;
    if (!el) return;
    const targetY = row * ROW_HEIGHT - el.clientHeight / 2 + ROW_HEIGHT / 2;
    // Instant вместо smooth: smooth-scroll к далёкому коммиту занимает
    // 500-1500мс анимации (это именно те длинные полосы в Performance
    // Animations-треке, которые читаются как «тормоз» при переключении
    // между репо, если у другого репо сохранён selectedCommitHash).
    const next = Math.max(0, targetY);
    el.scrollTop = next;
    lastScrollTopRef.current = next;
    scrollMemory.set(scopeKey, next);
  }, [scopeKey]);

  return { bodyRef, visibleRange, scrollToRow };
}
