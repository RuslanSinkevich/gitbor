import { useState, useEffect } from 'react';
import { t, onLangChange } from './index';
import type { Locale } from './index';

export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(t());

  useEffect(() => {
    return onLangChange(() => setLocale(t()));
  }, []);

  return locale;
}
