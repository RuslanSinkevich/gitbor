import { useEffect, useState } from 'react';

/**
 * Ненавязчивое напоминание «сказать спасибо автору». Логика хранится в
 * localStorage и устроена так, чтобы НЕ беспокоить пользователя:
 *   - в самый первый запуск только засекаем время и ничего не показываем;
 *   - дальше показываем не чаще раза в неделю;
 *   - кнопка «больше не показывать» отключает напоминание навсегда.
 */
const KEY = 'gitbor:support-prompt';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface SupportState {
  firstSeen: number;
  lastShown: number;
  dismissed: boolean;
}

function read(): SupportState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      firstSeen: Number(parsed.firstSeen) || Date.now(),
      lastShown: Number(parsed.lastShown) || 0,
      dismissed: parsed.dismissed === true,
    };
  } catch {
    return null;
  }
}

function write(state: SupportState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* приватный режим / квота — молча игнорируем, фича необязательная */
  }
}

export interface SupportPromptApi {
  open: boolean;
  /** Закрыть до следующей недели. */
  close: () => void;
  /** Больше не показывать никогда. */
  dismissForever: () => void;
  /** Открыть вручную (кнопка «Сказать спасибо» в About) — вне недельной логики. */
  openManually: () => void;
}

/**
 * `enabled` — показывать только когда пользователь реально работает с репо
 * (а не на пустом экране менеджера). Проверка одноразовая: срабатывает,
 * когда `enabled` впервые становится true.
 */
export function useSupportPrompt(enabled: boolean): SupportPromptApi {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const st = read();
    if (!st) {
      // Первый запуск — только засекаем, не беспокоим.
      write({ firstSeen: now, lastShown: now, dismissed: false });
      return;
    }
    if (st.dismissed) return;
    if (now - st.lastShown >= WEEK_MS) {
      setOpen(true);
      write({ ...st, lastShown: now });
    }
  }, [enabled]);

  const close = () => setOpen(false);

  const dismissForever = () => {
    const st = read() ?? { firstSeen: Date.now(), lastShown: Date.now(), dismissed: false };
    write({ ...st, dismissed: true });
    setOpen(false);
  };

  const openManually = () => setOpen(true);

  return { open, close, dismissForever, openManually };
}
