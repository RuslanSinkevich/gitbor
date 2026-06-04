import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { t } from '../../i18n';
import { copyToClipboard } from '../../api';
import { SgContextMenu, type SgContextMenuItem } from '../../ui/SgContextMenu';

/**
 * Контекстное меню «Копировать» по ПКМ на diff-контенте.
 *
 * Логика:
 *  - есть текстовое выделение в окне → «Копировать» (selection);
 *  - выделения нет → ищем ближайший элемент с `data-diff-line` (строки
 *    inline/split/whole-file отмечены этим атрибутом), копируем содержимое.
 *  - клик мимо строки → ничего не делаем (пускаем дальше — пусть нативное
 *    меню браузера, если оно нужно).
 *
 * Меню рендерится через `position: fixed` (см. `SgContextMenu`), поэтому
 * не требует портала и не конфликтует с глобальным меню `App.tsx`.
 */
export function useDiffCopyMenu(toolbarClassName?: string): {
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  /** Узел для рендера меню — вставить рядом с обработчиком. */
  menuNode: ReactNode;
  /** Inline-стиль для контейнера, если в нём важен `position: relative`. */
  menuContainerStyle?: CSSProperties;
} {
  const loc = t();
  const [menu, setMenu] = useState<{ x: number; y: number; items: SgContextMenuItem[] } | null>(null);

  const onContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (toolbarClassName && target.closest(`.${toolbarClassName}`)) return;

    const selection = typeof window !== 'undefined' ? window.getSelection?.()?.toString() ?? '' : '';
    let copyText: string;
    let label: string;

    if (selection.trim().length > 0) {
      copyText = selection;
      label = loc.diff.copySelection;
    } else {
      const row = target.closest('[data-diff-line]') as HTMLElement | null;
      if (!row) return;
      copyText = row.getAttribute('data-diff-line') ?? '';
      label = loc.diff.copyLine;
    }

    if (!copyText) return;

    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [{ label, action: () => copyToClipboard(copyText) }],
    });
  }, [loc.diff.copyLine, loc.diff.copySelection, toolbarClassName]);

  const menuNode = menu
    ? <SgContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
    : null;

  return { onContextMenu, menuNode };
}
