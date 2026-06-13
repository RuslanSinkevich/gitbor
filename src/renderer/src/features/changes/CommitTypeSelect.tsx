import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';
import type { ConventionalType } from '@core/git/commitMessageFormat';
import s from './CommitTypeSelect.module.css';

const MENU_GAP = 6;
const MENU_VIEWPORT_MARGIN = 12;
const MENU_MIN_HEIGHT = 160;

interface Props {
  types: readonly ConventionalType[];
  /** Тип, уже присутствующий в теме (если есть). */
  current: ConventionalType | null;
  /** Тип, показываемый в кнопке как подсказка, когда current пуст. */
  fallback: ConventionalType;
  onSelect: (type: ConventionalType) => void;
}

/**
 * Кнопка-селектор слева от темы коммита. Показывается в Conventional-режиме
 * только когда тема не проходит проверку формата: даёт быстрый способ
 * добавить корректный префикс. Открывает список типов вверх; высота меню
 * подстраивается под доступное место в окне.
 */
export function CommitTypeSelect({ types, current, fallback, onSelect }: Props) {
  const loc = t();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const repositionMenu = useCallback(() => {
    const anchor = rootRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // Меню раскрывается вверх (translateY(-100%)). Высоту ограничиваем
    // доступным местом от верха кнопки до верха окна — тогда при большом
    // окне всё содержимое влезает без скролла, а на узком окне сам
    // overflow-y:auto включит скролл.
    const available = Math.max(
      MENU_MIN_HEIGHT,
      rect.top - MENU_GAP - MENU_VIEWPORT_MARGIN,
    );
    setMenuStyle({
      top: rect.top - MENU_GAP,
      left: rect.left,
      transform: 'translateY(-100%)',
      maxHeight: available,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    repositionMenu();
    window.addEventListener('scroll', repositionMenu, true);
    window.addEventListener('resize', repositionMenu);
    return () => {
      window.removeEventListener('scroll', repositionMenu, true);
      window.removeEventListener('resize', repositionMenu);
    };
  }, [open, repositionMenu]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const shown = current ?? fallback;
  const descMap = loc.changes.commitTypeDesc as Record<string, string>;

  return (
    <div className={s.root} ref={rootRef}>
      <button
        type="button"
        className={`${s.button} ${current ? s.buttonActive : ''}`}
        title={loc.changes.commitTypeTitle}
        aria-label={loc.changes.commitTypeTitle}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M2.5 2h5.1c.4 0 .8.16 1.06.44l5 5a1.5 1.5 0 0 1 0 2.12l-3.94 3.94a1.5 1.5 0 0 1-2.12 0l-5-5A1.5 1.5 0 0 1 1.5 7.6V3a1 1 0 0 1 1-1Zm2 2.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
          />
        </svg>
        <span className={current ? s.typeText : s.typeTextMuted}>{shown}</span>
        <svg className={s.caret} width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
          <path fill="currentColor" d="M2 4l4 4 4-4z" />
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className={s.menu}
          role="listbox"
          style={menuStyle}
        >
          {types.map((type) => (
            <button
              key={type}
              type="button"
              role="option"
              aria-selected={type === current}
              className={`${s.item} ${type === current ? s.itemActive : ''}`}
              onClick={() => {
                onSelect(type);
                setOpen(false);
              }}
            >
              <span className={s.itemType}>{type}</span>
              <span className={s.itemDesc}>{descMap[type] ?? ''}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
