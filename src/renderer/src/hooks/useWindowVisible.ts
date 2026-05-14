import { useEffect, useState } from 'react';
import { onMainEvent } from '../api';

/**
 * Видимость GitBor-окна по событиям main → renderer:
 *  - false, когда main послал `windowVisibility: false` (minimize / hide).
 *  - true,  когда main послал `windowVisibility: true`  (restore / show).
 *
 * Используется фоновыми хуками (auto-fetch, polling), чтобы остановить
 * работу пока окно не на экране. Главная цель — не накапливать
 * renderer-heap и сетевые запросы в многочасовых свёрнутых сессиях.
 *
 * Изначальное значение — `true`: к моменту первого рендера окно
 * показано (`createWindow` → 'ready-to-show' → show), и пока main не
 * прислал явный `false`, ведём себя как обычно.
 */
export function useWindowVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    return onMainEvent((event) => {
      if (event.type === 'windowVisibility') {
        setVisible(event.visible);
      }
    });
  }, []);
  return visible;
}
