import { useEffect, useRef, useLayoutEffect, useState } from 'react';

export type SgContextMenuItem =
  | { divider: true; label?: undefined; shortcut?: undefined; disabled?: undefined; danger?: undefined; action?: undefined; header?: undefined; submenu?: undefined }
  | { header: true; label: string; action?: () => void; divider?: undefined; shortcut?: undefined; disabled?: undefined; danger?: undefined; submenu?: undefined }
  | {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      divider?: false;
      header?: false;
      action?: () => void;
      /** Если задано — пункт открывает дочернее меню справа, `action` игнорируется. */
      submenu?: SgContextMenuItem[];
    };

interface SgContextMenuProps {
  x: number;
  y: number;
  items: SgContextMenuItem[];
  onClose: () => void;
}

export function SgContextMenu({ x, y, items, onClose }: SgContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) el.style.left = `${Math.max(0, vw - rect.width - 4)}px`;
    if (rect.bottom > vh) el.style.top = `${Math.max(0, vh - rect.height - 4)}px`;
  }, [x, y]);

  return (
    <div ref={ref} className="sg-context-menu" style={{ left: x, top: y }}>
      <MenuItems items={items} onClose={onClose} />
    </div>
  );
}

interface MenuItemsProps {
  items: SgContextMenuItem[];
  onClose: () => void;
}

function MenuItems({ items, onClose }: MenuItemsProps) {
  const [openSubmenuIdx, setOpenSubmenuIdx] = useState<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpenSubmenuIdx(null), 180);
  };

  useEffect(() => () => cancelClose(), []);

  return (
    <>
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="sg-context-menu-divider" />
        ) : item.header ? (
          <div
            key={i}
            className="sg-context-menu-header"
            onClick={() => { item.action?.(); onClose(); }}
          >
            <span>{item.label}</span>
          </div>
        ) : item.submenu && item.submenu.length > 0 ? (
          <SubmenuItem
            key={i}
            item={item}
            open={openSubmenuIdx === i}
            onOpen={() => { cancelClose(); setOpenSubmenuIdx(i); }}
            onScheduleClose={scheduleClose}
            onClose={onClose}
          />
        ) : (
          <div
            key={i}
            className={`sg-context-menu-item ${item.danger ? 'sg-context-menu-item--danger' : ''} ${item.disabled ? 'sg-context-menu-item--disabled' : ''}`}
            onMouseEnter={() => setOpenSubmenuIdx(null)}
            onClick={() => {
              if (!item.disabled) {
                item.action?.();
                onClose();
              }
            }}
            title={item.label}
          >
            <span className="sg-context-menu-item-label">{item.label}</span>
            {item.shortcut && <span className="sg-context-menu-shortcut">{item.shortcut}</span>}
          </div>
        ),
      )}
    </>
  );
}

interface SubmenuItemProps {
  item: Extract<SgContextMenuItem, { submenu?: SgContextMenuItem[] }>;
  open: boolean;
  onOpen: () => void;
  onScheduleClose: () => void;
  onClose: () => void;
}

function SubmenuItem({ item, open, onOpen, onScheduleClose, onClose }: SubmenuItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; flipLeft: boolean } | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleOpen = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(onOpen, 160);
  };

  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const host = itemRef.current?.getBoundingClientRect();
    const sub = subRef.current?.getBoundingClientRect();
    if (!host) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const subW = sub?.width ?? 220;
    const subH = sub?.height ?? 120;
    const flipLeft = host.right + subW > vw - 4;
    const left = flipLeft ? Math.max(4, host.left - subW) : host.right;
    const top = Math.min(host.top, Math.max(4, vh - subH - 4));
    setPos({ left, top, flipLeft });
  }, [open]);

  return (
    <div
      ref={itemRef}
      className={`sg-context-menu-item ${item.danger ? 'sg-context-menu-item--danger' : ''} ${item.disabled ? 'sg-context-menu-item--disabled' : ''}`}
      onMouseEnter={scheduleOpen}
      onMouseLeave={() => {
        if (openTimer.current) clearTimeout(openTimer.current);
        onScheduleClose();
      }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      title={item.label}
    >
      <span className="sg-context-menu-item-label">{item.label}</span>
      <span className="sg-context-menu-arrow">▸</span>
      {open && pos && (
        <div
          ref={subRef}
          className="sg-context-menu"
          style={{ left: pos.left, top: pos.top }}
          onMouseEnter={() => {/* hover saved by parent's cancelClose via onOpen path */}}
        >
          <MenuItems items={item.submenu!} onClose={onClose} />
        </div>
      )}
    </div>
  );
}
