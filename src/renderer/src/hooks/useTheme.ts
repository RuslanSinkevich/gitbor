import { useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  return (localStorage.getItem('sg-theme') as Theme) || 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sg-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggleTheme };
}
