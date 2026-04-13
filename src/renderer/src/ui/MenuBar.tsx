import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './MenuBar.module.css';

export interface MenuItem {
  label: string;
  accelerator?: string;
  action?: () => void;
  type?: 'separator';
  disabled?: boolean;
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

  function handleItemClick(item: MenuItem) {
    if (item.disabled || item.type === 'separator') return;
    close();
    item.action?.();
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
              {menu.items.map((item, i) =>
                item.type === 'separator' ? (
                  <div key={i} className={styles.separator} />
                ) : (
                  <button
                    key={i}
                    className={`${styles.menuItem} ${item.disabled ? styles.menuItemDisabled : ''}`}
                    onClick={() => handleItemClick(item)}
                    disabled={item.disabled}
                  >
                    <span className={styles.menuItemLabel}>{item.label}</span>
                    {item.accelerator && (
                      <span className={styles.menuItemAccel}>{item.accelerator}</span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
