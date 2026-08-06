import { useState, useCallback } from 'react';

type Theme = 'dark' | 'light';
const STORAGE_KEY = 'nodaq-theme';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  if (theme === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
  localStorage.setItem(STORAGE_KEY, theme);
}

/**
 * Reads / writes the NODAQ theme preference.
 * The flash-prevention script in index.html already applied the class
 * synchronously, so we only need to mirror that state here and toggle on demand.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  const toggle = useCallback(() => {
    setThemeState(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, toggle };
}
