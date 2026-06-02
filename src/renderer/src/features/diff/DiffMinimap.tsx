import { useRef, useEffect, useCallback } from 'react';
import type { ChangeMark } from './diffRows';
import s from './DiffView.module.css';

interface Props {
  /** Метки изменений (по одной на изменённую строку), ratio в [0..1). */
  marks: ChangeMark[];
  /** Текущий scrollTop основного контейнера diff. */
  scrollTop: number;
  /** Высота видимой области контейнера (clientHeight). */
  viewport: number;
  /** Полная высота контента. */
  content: number;
  /** Перейти к позиции: ratio в [0..1] от верха контента. */
  onSeek: (ratioTop: number) => void;
}

/** Fallback-цвета, если CSS-переменные темы недоступны. */
const FALLBACK_ADD = '#2ea043';
const FALLBACK_DEL = '#f85149';

/**
 * Fork-style полоса-обзор изменений справа от diff. Метки add/remove/modify
 * рисуются на canvas (один проход на смену rows, не на каждый скролл), поверх
 * — рамка текущего вьюпорта (DOM-div, двигается по scrollTop). Клик/драг по
 * полосе перематывает diff. Canvas масштабируется под devicePixelRatio.
 */
export function DiffMinimap({ marks, scrollTop, viewport, content, onSeek }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Цвета берём из тех же CSS-переменных, что и подсветка строк
    // (.lineAdd/.lineRemove), чтобы полоса-обзор совпадала с разметкой полей
    // при любой теме. modify (удаление+добавление) → цвет «итогового» add.
    const cs = getComputedStyle(wrap);
    const addColor = cs.getPropertyValue('--sg-diff-add-bg').trim() || FALLBACK_ADD;
    const delColor = cs.getPropertyValue('--sg-diff-del-bg').trim() || FALLBACK_DEL;
    const colorByType: Record<ChangeMark['type'], string> = {
      add: addColor,
      remove: delColor,
      modify: addColor,
    };
    // Высота метки = доля одной строки, но не тоньше 2px — чтобы единичные
    // изменения были заметны на длинном файле (как overview-ruler в VS).
    const markH = Math.max(2, Math.min(4, h / Math.max(1, marks.length || 1)));
    for (const m of marks) {
      ctx.fillStyle = colorByType[m.type];
      ctx.fillRect(0, m.ratio * h, w, markH);
    }
  }, [marks]);

  useEffect(() => {
    draw();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  const seekFromEvent = useCallback((clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    onSeek(ratio);
  }, [onSeek]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    seekFromEvent(e.clientY);
  }, [seekFromEvent]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    seekFromEvent(e.clientY);
  }, [seekFromEvent]);

  const boxTop = content > 0 ? `${(scrollTop / content) * 100}%` : '0';
  const boxHeight = content > 0 ? `${Math.min(100, (viewport / content) * 100)}%` : '100%';

  return (
    <div
      ref={wrapRef}
      className={s.minimap}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      role="presentation"
    >
      <canvas ref={canvasRef} className={s.minimapCanvas} />
      <div className={s.minimapViewport} style={{ top: boxTop, height: boxHeight }} />
    </div>
  );
}
