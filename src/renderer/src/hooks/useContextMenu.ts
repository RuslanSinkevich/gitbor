import { useState, useCallback } from 'react';
import type { SgContextMenuItem } from '../ui/SgContextMenu';

interface ContextMenuState {
  x: number;
  y: number;
  items: SgContextMenuItem[];
}

export type ShowContextMenuFn = (e: React.MouseEvent, items: SgContextMenuItem[]) => void;

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const showContextMenu = useCallback<ShowContextMenuFn>((e, items) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return { contextMenu, showContextMenu, closeContextMenu };
}
