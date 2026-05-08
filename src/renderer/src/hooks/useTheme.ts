import { useState, useEffect, useCallback } from 'react';
import { loadStoredString, saveStoredString } from '../shared/uiPersist';

type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  return (loadStoredString('sg-theme') as Theme) || 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    saveStoredString('sg-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggleTheme };
}
