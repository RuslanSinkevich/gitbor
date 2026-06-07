import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import styles from './MenuBar.module.css';

interface MenuItem {
  label: string;
  accelerator?: string;
  action?: () => void;
  type?: 'separator';
  disabled?: boolean;
  /** Если задано — пункт раскрывает дочернее меню справа; `action` игнорируется. */
  submenu?: MenuItem[];
}

export interface MenuGroup {
  label: string;
  items: MenuItem[];
}

interface Props {
  menus: MenuGroup[];
}

export function MenuBar({ menus }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [hoverEnabled, setHoverEnabled] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpenIndex(null);
    setHoverEnabled(false);
  }, []);

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [openIndex, close]);

  function handleTopClick(idx: number) {
    if (openIndex === idx) {
      close();
    } else {
      setOpenIndex(idx);
      setHoverEnabled(true);
    }
  }

  function handleTopEnter(idx: number) {
    if (hoverEnabled && openIndex !== null) {
      setOpenIndex(idx);
    }
  }

  return (
    <div className={styles.bar} ref={barRef}>
      {menus.map((menu, idx) => (
        <div key={menu.label} className={styles.menuRoot}>
          <button
            className={`${styles.topItem} ${openIndex === idx ? styles.topItemActive : ''}`}
            onMouseDown={(e) => { e.preventDefault(); handleTopClick(idx); }}
            onMouseEnter={() => handleTopEnter(idx)}
          >
            {menu.label}
          </button>
          {openIndex === idx && (
            <div className={styles.dropdown}>
              <DropdownItems items={menu.items} onClose={close} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface DropdownItemsProps {
  items: MenuItem[];
  onClose: () => void;
}

function DropdownItems({ items, onClose }: DropdownItemsProps) {
  const [openSubIdx, setOpenSubIdx] = useState<number | null>(null);

  function handleItemClick(item: MenuItem) {
    if (item.disabled || item.type === 'separator') return;
    onClose();
    item.action?.();
  }

  return (
    <>
      {items.map((item, i) =>
        item.type === 'separator' ? (
          <div key={i} className={styles.separator} />
        ) : item.submenu && item.submenu.length > 0 ? (
          <SubmenuItem
            key={i}
            item={item}
            open={openSubIdx === i}
            onOpen={() => setOpenSubIdx(i)}
            onClose={onClose}
          />
        ) : (
          <button
            key={i}
            className={`${styles.menuItem} ${item.disabled ? styles.menuItemDisabled : ''}`}
            onClick={() => handleItemClick(item)}
            onMouseEnter={() => setOpenSubIdx(null)}
            disabled={item.disabled}
          >
            <span className={styles.menuItemLabel}>{item.label}</span>
            {item.accelerator && (
              <span className={styles.menuItemAccel}>{item.accelerator}</span>
            )}
          </button>
        )
      )}
    </>
  );
}

interface SubmenuItemProps {
  item: MenuItem;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function SubmenuItem({ item, open, onOpen, onClose }: SubmenuItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [flipLeft, setFlipLeft] = useState(false);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    // Если справа не хватает места под флай-аут — раскрываем влево.
    setFlipLeft(rect.right + 224 > window.innerWidth);
  }, [open]);

  return (
    <div ref={ref} className={styles.submenuRoot} onMouseEnter={onOpen}>
      <button
        className={styles.menuItem}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
      >
        <span className={styles.menuItemLabel}>{item.label}</span>
        <span className={styles.submenuArrow}>▸</span>
      </button>
      {open && (
        <div className={`${styles.dropdown} ${styles.submenuDropdown} ${flipLeft ? styles.submenuDropdownLeft : ''}`}>
          <DropdownItems items={item.submenu!} onClose={onClose} />
        </div>
      )}
    </div>
  );
}
