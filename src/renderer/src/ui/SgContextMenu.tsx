import { useEffect, useRef, useLayoutEffect } from 'react';

export type SgContextMenuItem =
  | { divider: true; label?: undefined; shortcut?: undefined; disabled?: undefined; danger?: undefined; action?: undefined; header?: undefined }
  | { header: true; label: string; action?: () => void; divider?: undefined; shortcut?: undefined; disabled?: undefined; danger?: undefined }
  | { label: string; shortcut?: string; disabled?: boolean; danger?: boolean; divider?: false; header?: false; action?: () => void };

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
        ) : (
          <div
            key={i}
            className={`sg-context-menu-item ${item.danger ? 'sg-context-menu-item--danger' : ''} ${item.disabled ? 'sg-context-menu-item--disabled' : ''}`}
            onClick={() => {
              if (!item.disabled) {
                item.action?.();
                onClose();
              }
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="sg-context-menu-shortcut">{item.shortcut}</span>}
          </div>
        ),
      )}
    </div>
  );
}
